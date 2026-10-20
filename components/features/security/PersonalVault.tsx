"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STORAGE_BUCKET } from "@/lib/chatcloud/constants";
import { decryptFile, encryptFile, validatePin } from "@/lib/security/file-crypto";

type CloudFile = {
  id: string;
  display_name: string;
  mime_type: string | null;
  size_bytes: number;
  storage_path: string;
  is_vaulted: boolean;
  is_hidden: boolean;
};

type VaultFile = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  encryption_salt: string;
  encryption_iv: string;
  pin_digits: number;
  original_file_id: string;
  is_hidden: boolean;
  created_at: string;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const inputClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
  return result;
}

function formatSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PersonalVault() {
  const supabase = useMemo(() => createClient(), []);
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lockTarget, setLockTarget] = useState<CloudFile | null>(null);
  const [hideWhenLocking, setHideWhenLocking] = useState(false);
  const [pin, setPin] = useState("");
  const [pinConfirmation, setPinConfirmation] = useState("");
  const [unlockTarget, setUnlockTarget] = useState<VaultFile | null>(null);
  const [unlockedFile, setUnlockedFile] = useState<{
    vaultFileId: string;
    fileName: string;
    mimeType: string;
    objectUrl: string;
    bytes: ArrayBuffer;
    textContent: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: cloudFiles, error: fileError }, vaultResult] = await Promise.all([
        supabase.from("cloud_files")
          .select("id, display_name, mime_type, size_bytes, storage_path, is_vaulted, is_hidden")
          .order("created_at", { ascending: false })
          .limit(500),
        getJson<{ files: VaultFile[] }>("/api/security/vault"),
      ]);
      if (fileError) throw new Error(fileError.message);
      setFiles((cloudFiles ?? []) as CloudFile[]);
      setVaultFiles(vaultResult.files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your vault.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (unlockedFile) URL.revokeObjectURL(unlockedFile.objectUrl);
    };
  }, [unlockedFile]);

  async function lockFile() {
    if (!lockTarget) return;
    setError(null);
    setNotice(null);
    setBusyId(lockTarget.id);
    try {
      validatePin(pin, 4);
      if (pin !== pinConfirmation) throw new Error("The PIN entries do not match.");
      if (lockTarget.size_bytes > MAX_FILE_BYTES) throw new Error("Vault files must be 10 MB or smaller.");
      const { data: source, error: downloadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(lockTarget.storage_path);
      if (downloadError || !source) throw new Error(downloadError?.message ?? "Could not read the original file.");
      const result = await encryptFile(await source.arrayBuffer(), pin);
      const body = new FormData();
      body.set("fileId", lockTarget.id);
      body.set("salt", result.salt);
      body.set("iv", result.iv);
      body.set("hideFromChatcloud", String(hideWhenLocking));
      body.set("file", new File([result.encrypted], "encrypted-file", {
        type: lockTarget.mime_type || "application/octet-stream",
      }));
      await getJson("/api/security/vault", { method: "POST", body });
      setPin("");
      setPinConfirmation("");
      setLockTarget(null);
      setHideWhenLocking(false);
      setNotice(`${lockTarget.display_name} is now encrypted in your vault with a four-digit PIN. Keep it safe; it cannot be reset.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not lock this file.");
    } finally {
      setBusyId(null);
    }
  }

  async function unlockFile() {
    if (!unlockTarget) return;
    setError(null);
    setNotice(null);
    setBusyId(unlockTarget.id);
    try {
      validatePin(pin, unlockTarget.pin_digits);
      const { url } = await getJson<{ url: string }>(`/api/security/vault/${encodeURIComponent(unlockTarget.id)}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not retrieve the encrypted vault file.");
      const mimeType = unlockTarget.mime_type;
      const decrypted = await decryptFile(
        await response.arrayBuffer(),
        pin,
        unlockTarget.encryption_salt,
        unlockTarget.encryption_iv,
        unlockTarget.pin_digits,
      );
      const blob = new Blob([decrypted], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const textContent = mimeType.startsWith("text/") ? await blob.text() : null;
      setUnlockedFile({
        vaultFileId: unlockTarget.id,
        fileName: unlockTarget.file_name,
        mimeType,
        objectUrl,
        bytes: decrypted,
        textContent,
      });
      setPin("");
      setPinConfirmation("");
      setUnlockTarget(null);
      setNotice(`${unlockTarget.file_name} is unlocked in this browser.`);
    } catch (err) {
      setError(err instanceof Error && err.name === "OperationError"
        ? "That PIN did not unlock this file."
        : err instanceof Error ? err.message : "Could not unlock this file.");
    } finally {
      setBusyId(null);
    }
  }

  async function unlockPermanently() {
    if (!unlockedFile || busyId) return;
    if (!window.confirm(`Unlock "${unlockedFile.fileName}" permanently? This restores it to ChatCloud without PIN protection.`)) return;
    setBusyId(unlockedFile.vaultFileId);
    setError(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("file", new File([unlockedFile.bytes], unlockedFile.fileName, { type: unlockedFile.mimeType }));
      const result = await getJson<{ warning?: string }>(
        `/api/security/vault/${encodeURIComponent(unlockedFile.vaultFileId)}/restore`,
        { method: "POST", body },
      );
      setUnlockedFile(null);
      setNotice(result.warning ?? `${unlockedFile.fileName} was restored to ChatCloud without PIN protection.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock this file permanently.");
    } finally {
      setBusyId(null);
    }
  }

  async function setHiddenInChatcloud(file: VaultFile, isHidden: boolean) {
    setBusyId(file.id);
    setError(null);
    setNotice(null);
    try {
      await getJson(`/api/security/vault/${encodeURIComponent(file.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isHidden }),
      });
      setVaultFiles((current) => current.map((item) => item.id === file.id ? { ...item, is_hidden: isHidden } : item));
      setFiles((current) => current.map((item) => item.id === file.original_file_id ? { ...item, is_hidden: isHidden } : item));
      setNotice(isHidden ? `${file.file_name} is now hidden from ChatCloud.` : `${file.file_name} is visible in ChatCloud again.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this file's visibility.");
    } finally {
      setBusyId(null);
    }
  }

  const availableFiles = files.filter((file) => !file.is_vaulted);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        Files are encrypted in your browser with AES-GCM before the original cloud copy is removed.
        The four-digit PIN is never sent to MyCloud. Four digits are easier to guess than a longer PIN; losing the PIN means the file cannot be recovered.
      </div>

      {(error || notice) && (
        <p role={error ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
          {error ?? notice}
        </p>
      )}

      <section>
        <h2 className="font-semibold text-slate-900">Lock a ChatCloud file</h2>
        <p className="mt-1 text-sm text-slate-500">Choose a file and set a four-digit PIN. Locking removes its unencrypted cloud copy.</p>
        {loading ? <p className="mt-4 text-sm text-slate-500">Loading files…</p> : availableFiles.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No unlocked ChatCloud files available.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {availableFiles.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">{file.display_name}</span>
                  <span className="text-xs text-slate-500">{formatSize(file.size_bytes)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => { setError(null); setNotice(null); setPin(""); setPinConfirmation(""); setHideWhenLocking(file.is_hidden); setLockTarget(file); }}
                  disabled={file.size_bytes > MAX_FILE_BYTES || busyId !== null}
                  className="rounded-lg border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                  title={file.size_bytes > MAX_FILE_BYTES ? "Files must be 10 MB or smaller" : undefined}
                >
                  Lock with PIN
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-semibold text-slate-900">Encrypted vault</h2>
        {loading ? <p className="mt-4 text-sm text-slate-500">Loading vault…</p> : vaultFiles.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Your vault is empty.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {vaultFiles.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">🔒 {file.file_name}</span>
                  <span className="text-xs text-slate-500">
                    {formatSize(file.size_bytes)} · encrypted {new Date(file.created_at).toLocaleDateString()}
                    {file.is_hidden && " · hidden from ChatCloud"}
                  </span>
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void setHiddenInChatcloud(file, !file.is_hidden)}
                    disabled={busyId !== null}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {busyId === file.id ? "Saving…" : file.is_hidden ? "Show in ChatCloud" : "Hide in ChatCloud"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setError(null); setNotice(null); setPin(""); setPinConfirmation(""); setUnlockTarget(file); }}
                    disabled={busyId !== null}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Unlock
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(lockTarget || unlockTarget) && (
        <div role="dialog" aria-modal="true" aria-labelledby="vault-pin-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={(event) => { event.preventDefault(); void (lockTarget ? lockFile() : unlockFile()); }}
            className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl"
          >
            <h2 id="vault-pin-title" className="text-lg font-semibold text-slate-900">
              {lockTarget ? `Set PIN for ${lockTarget.display_name}` : `Unlock ${unlockTarget?.file_name}`}
            </h2>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <label className="block text-sm font-medium text-slate-700">
              {unlockTarget ? `${unlockTarget.pin_digits}-digit PIN` : "Four-digit PIN"}
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                pattern={`[0-9]{${unlockTarget?.pin_digits ?? 4}}`}
                maxLength={unlockTarget?.pin_digits ?? 4}
                minLength={unlockTarget?.pin_digits ?? 4}
                required
                autoComplete="new-password"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, unlockTarget?.pin_digits ?? 4))}
                className={`${inputClass} mt-1 block w-full`}
              />
            </label>
            {lockTarget && (
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={hideWhenLocking}
                  onChange={(event) => setHideWhenLocking(event.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Hide this file from the ChatCloud Files page</span>
              </label>
            )}
            {lockTarget && (
              <label className="block text-sm font-medium text-slate-700">
                Confirm PIN
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  minLength={4}
                  required
                  autoComplete="new-password"
                  value={pinConfirmation}
                  onChange={(event) => setPinConfirmation(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  className={`${inputClass} mt-1 block w-full`}
                />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setLockTarget(null); setUnlockTarget(null); setPin(""); setPinConfirmation(""); setHideWhenLocking(false); setError(null); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
                Cancel
              </button>
              <button type="submit" disabled={busyId !== null || pin.length !== (unlockTarget?.pin_digits ?? 4) || (Boolean(lockTarget) && pinConfirmation !== pin)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busyId ? "Working…" : lockTarget ? "Encrypt and lock" : "Unlock"}
              </button>
            </div>
          </form>
        </div>
      )}

      {unlockedFile && (
        <div role="dialog" aria-modal="true" aria-labelledby="unlocked-file-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <section className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h2 id="unlocked-file-title" className="min-w-0 truncate font-semibold text-slate-900">{unlockedFile.fileName}</h2>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setUnlockedFile(null)}
                  disabled={busyId !== null}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Lock
                </button>
                <button
                  type="button"
                  onClick={() => void unlockPermanently()}
                  disabled={busyId !== null}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busyId === unlockedFile.vaultFileId ? "Restoring…" : "Unlock permanently"}
                </button>
              </div>
            </header>
            <div className="min-h-48 overflow-auto p-4">
              {unlockedFile.mimeType.startsWith("image/") ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={unlockedFile.objectUrl} alt={unlockedFile.fileName} className="mx-auto max-h-[75vh] max-w-full object-contain" />
              ) : unlockedFile.mimeType === "application/pdf" ? (
                <iframe title={unlockedFile.fileName} src={unlockedFile.objectUrl} className="h-[75vh] w-full rounded border border-slate-200" />
              ) : unlockedFile.mimeType.startsWith("video/") ? (
                <video src={unlockedFile.objectUrl} controls className="mx-auto max-h-[75vh] max-w-full" />
              ) : unlockedFile.mimeType.startsWith("audio/") ? (
                <audio src={unlockedFile.objectUrl} controls className="mx-auto mt-8 w-full max-w-xl" />
              ) : unlockedFile.textContent !== null ? (
                <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{unlockedFile.textContent}</pre>
              ) : (
                <p className="py-12 text-center text-sm leading-6 text-slate-600">
                  This file is unlocked in browser memory, but its format cannot be previewed here. Choose Lock to clear it or Unlock permanently to restore it to ChatCloud without PIN protection.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
