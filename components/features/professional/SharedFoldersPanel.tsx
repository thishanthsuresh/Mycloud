"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ProfessionalOrganization } from "./ProfessionalSpace";

type Member = { id: string; display_name: string; email: string; role: "manager" | "employee"; status: "invited" | "active" };
type Folder = { id: string; name: string; description: string; accessibleMemberIds: string[]; canManage: boolean; created_at: string };
type SharedFile = { id: string; file_name: string; mime_type: string; size_bytes: number; url: string; created_at: string };
type ApiError = { error?: string };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
  return result;
}

export default function SharedFoldersPanel({ organization }: { organization: ProfessionalOrganization }) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const baseUrl = `/api/professional/${encodeURIComponent(organization.id)}`;
  const isManager = organization.membership.role === "manager";

  const loadFiles = useCallback(async (folderId: string) => {
    if (!folderId) {
      setFiles([]);
      return;
    }
    const result = await requestJson<{ files: SharedFile[] }>(`${baseUrl}/folders/${encodeURIComponent(folderId)}/files`);
    setFiles(result.files);
  }, [baseUrl]);

  const loadFolders = useCallback(async () => {
    setLoading(true);
    try {
      const result = await requestJson<{ folders: Folder[] }>(`${baseUrl}/folders`);
      setFolders(result.folders);
      setSelectedFolderId((current) => result.folders.some((folder) => folder.id === current) ? current : result.folders[0]?.id ?? "");
      if (isManager) {
        const memberResult = await requestJson<{ members: Member[] }>(`${baseUrl}/members`);
        setMembers(memberResult.members.filter((member) => member.role === "employee" && member.status === "active"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load shared folders.");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, isManager]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFolders(), 0);
    return () => window.clearTimeout(timer);
  }, [loadFolders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFiles(selectedFolderId).catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load shared files."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFiles, selectedFolderId]);

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<{ folder: Folder }>(`${baseUrl}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: folderName, description, memberIds: selectedMemberIds }),
      });
      setFolders((current) => [result.folder, ...current]);
      setSelectedFolderId(result.folder.id);
      setFolderName("");
      setDescription("");
      setSelectedMemberIds([]);
      setNotice("Shared folder created with the selected access.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a shared folder.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadFile || !selectedFolderId || uploading) return;
    if (uploadFile.size > MAX_FILE_BYTES) {
      setError("Documents must be 10 MB or smaller.");
      return;
    }
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("file", uploadFile);
      await requestJson(`${baseUrl}/folders/${encodeURIComponent(selectedFolderId)}/files`, { method: "POST", body });
      setUploadFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await loadFiles(selectedFolderId);
      setNotice("Document added to the shared folder.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the shared document.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg font-bold text-slate-900">Shared folders</h2>
        <p className="mt-1 text-sm text-slate-500">{isManager ? "Create folders and select exactly which employees can access them." : "Folders shared with you by your organization manager."}</p>
      </header>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      {isManager && (
        <form onSubmit={(event) => void createFolder(event)} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-800">Create a shared folder</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">Folder name
              <input required maxLength={120} value={folderName} onChange={(event) => setFolderName(event.target.value)} className={`${inputClass} mt-1 bg-white font-normal`} placeholder="Project documents" />
            </label>
            <label className="text-xs font-semibold text-slate-600">Description <span className="font-normal">(optional)</span>
              <input maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} className={`${inputClass} mt-1 bg-white font-normal`} placeholder="What this folder is for" />
            </label>
          </div>
          <fieldset>
            <legend className="text-xs font-semibold text-slate-600">Give access to selected active employees</legend>
            {members.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {members.map((member) => {
                  const checked = selectedMemberIds.includes(member.id);
                  return (
                    <label key={member.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${checked ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600"}`}>
                      <input type="checkbox" checked={checked} onChange={(event) => setSelectedMemberIds((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} />
                      {member.display_name}
                    </label>
                  );
                })}
              </div>
            ) : <p className="mt-2 text-xs text-slate-500">Invite staff and wait for them to accept before granting access.</p>}
          </fieldset>
          <button type="submit" disabled={saving || !folderName.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? "Creating…" : "Create folder"}</button>
        </form>
      )}

      {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading folders…</p> : folders.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{isManager ? "Create a folder and grant access to selected staff." : "No folders have been shared with you yet."}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Shared folders" className="space-y-2">
            {folders.map((folder) => (
              <button key={folder.id} type="button" onClick={() => { setSelectedFolderId(folder.id); setError(null); }} className={`w-full rounded-xl border p-3 text-left transition ${selectedFolderId === folder.id ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                <span className="block truncate text-sm font-semibold text-slate-900">📁 {folder.name}</span>
                {folder.description && <span className="mt-1 block line-clamp-2 text-xs text-slate-500">{folder.description}</span>}
              </button>
            ))}
          </nav>
          <div className="min-w-0 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">{folders.find((folder) => folder.id === selectedFolderId)?.name}</h3>
              {isManager && <span className="text-xs text-slate-500">{folders.find((folder) => folder.id === selectedFolderId)?.accessibleMemberIds.length ?? 0} selected staff</span>}
            </div>
            <form onSubmit={(event) => void uploadDocument(event)} className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
              <input ref={fileInput} type="file" accept="image/*,application/pdf,text/plain,.doc,.docx,.xlsx" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} className="min-w-0 flex-1 text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-medium file:text-indigo-700" />
              <button type="submit" disabled={!uploadFile || uploading} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{uploading ? "Uploading…" : "Upload file"}</button>
            </form>
            {files.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No documents in this folder yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {files.map((file) => (
                  <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{file.file_name}</p>
                      <p className="text-xs text-slate-500">{(file.size_bytes / 1024).toFixed(0)} KB · {new Date(file.created_at).toLocaleDateString()}</p>
                    </div>
                    <a href={file.url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-slate-50">Open file</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
