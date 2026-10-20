"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { encryptFile, generatePin } from "@/lib/security/file-crypto";
import { createClient } from "@/lib/supabase/client";

type MessengerUser = { user_id: string; email: string; display_name: string };
type ApiError = { error?: string };

const MAX_FILE_BYTES = 10 * 1024 * 1024 - 16;
const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
  return result;
}

export default function EncryptedShare() {
  const [supabase] = useState(createClient);
  const [email, setEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentUserId = useRef<string | null | undefined>(undefined);
  const operationId = useRef(0);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (currentUserId.current === undefined) {
        currentUserId.current = nextUserId;
        return;
      }
      if (currentUserId.current === nextUserId) return;

      currentUserId.current = nextUserId;
      operationId.current += 1;
      setEmail("");
      setFile(null);
      setPin(null);
      setRecipient(null);
      setSending(false);
      setError(null);
      setNotice(null);
      if (fileInput.current) fileInput.current.value = "";
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  async function shareFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || sending) return;
    const currentOperation = operationId.current;
    setError(null);
    setNotice(null);
    setPin(null);
    setRecipient(null);
    setSending(true);
    try {
      if (file.size === 0 || file.size > MAX_FILE_BYTES) throw new Error("Choose a file smaller than 10 MB.");
      const { user } = await requestJson<{ user: MessengerUser }>(
        `/api/messenger/users?email=${encodeURIComponent(email.trim())}`,
      );
      if (operationId.current !== currentOperation) return;
      const { conversationId } = await requestJson<{ conversationId: string }>("/api/messenger/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: user.user_id }),
      });
      if (operationId.current !== currentOperation) return;

      const generatedPin = generatePin();
      const encrypted = await encryptFile(await file.arrayBuffer(), generatedPin);
      if (operationId.current !== currentOperation) return;
      const body = new FormData();
      body.set("conversationId", conversationId);
      body.set("body", "🔐 PIN-protected file");
      body.set("isEncrypted", "true");
      body.set("encryptionSalt", encrypted.salt);
      body.set("encryptionIv", encrypted.iv);
      body.set("pinDigits", "4");
      body.set("originalMimeType", file.type || "application/octet-stream");
      body.set("media", new File([encrypted.encrypted], file.name, { type: "application/octet-stream" }));
      await requestJson("/api/messenger/messages", { method: "POST", body });

      if (operationId.current !== currentOperation) return;
      setPin(generatedPin);
      setRecipient(user.display_name || user.email);
      setNotice("Encrypted file delivered to the recipient's Messenger.");
      setFile(null);
      setEmail("");
      if (fileInput.current) fileInput.current.value = "";
    } catch (err) {
      if (operationId.current === currentOperation) {
        setError(err instanceof Error ? err.message : "Could not encrypt and share the file.");
      }
    } finally {
      if (operationId.current === currentOperation) setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm leading-6 text-indigo-950">
        The file is encrypted in this browser before it is sent through Messenger. MyCloud stores only the encrypted attachment.
        The generated PIN is shown only after delivery; give it to the recipient separately.
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
      {pin && (
        <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-900">Share this PIN with {recipient} through a separate, trusted channel:</p>
          <p className="mt-2 font-mono text-3xl font-bold tracking-[0.3em] text-emerald-950" aria-label={`Decryption PIN ${pin}`}>{pin}</p>
          <p className="mt-2 text-xs text-emerald-800">This four-digit PIN cannot be recovered from MyCloud. Four-digit PINs are easy to guess if an attacker gets the encrypted file, so use only for less-sensitive sharing and share the PIN separately. The recipient opens the attachment in Messenger and enters this PIN.</p>
        </section>
      )}
      <form onSubmit={(event) => void shareFile(event)} className="max-w-xl space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          Recipient MyCloud email
          <input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={`${inputClass} mt-1`} placeholder="name@example.com" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          File to encrypt and send
          <input
            ref={fileInput}
            type="file"
            required
            onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPin(null); setNotice(null); }}
            className={`${inputClass} mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700`}
          />
        </label>
        {file && <p className="text-xs text-slate-500">{file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MB</p>}
        <button type="submit" disabled={sending || !file || !email.trim()} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
          {sending ? "Encrypting and sending…" : "Encrypt and send in Messenger"}
        </button>
      </form>
    </div>
  );
}
