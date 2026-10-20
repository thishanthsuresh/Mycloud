"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DataTable, { type Column } from "@/components/ui/DataTable";
import EmptyState from "@/components/ui/EmptyState";
import FormModal from "@/components/ui/FormModal";
import { useChatcloudCategories } from "@/hooks/useChatcloudCategories";
import { useChatcloudFiles, type UploadedFileReview } from "@/hooks/useChatcloudFiles";
import { categoryIcon } from "@/lib/chatcloud/categories";
import { MAX_WEB_UPLOAD_BYTES } from "@/lib/chatcloud/constants";
import { humanSize } from "@/lib/chatcloud/utils";
import type { ChatcloudCategory, CloudFile } from "@/types/chatcloud";

const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
const SEEN_MESSENGER_FILES_KEY = "chatcloud.seenMessengerFiles";

export default function FilesTab() {
  const { files, loading, error, uploading, refresh, updateFile, deleteFile, getSignedUrl, uploadFiles } = useChatcloudFiles();
  const { categories, loading: categoriesLoading, error: categoriesError, createCategory, deleteCategory, refresh: refreshCategories } = useChatcloudCategories();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sortBy, setSortBy] = useState<"newest" | "least-recently-opened" | "most-recently-opened">("newest");
  const [notice, setNotice] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<ChatcloudCategory | null>(null);
  const [deleteCategoryBusy, setDeleteCategoryBusy] = useState(false);

  const [editing, setEditing] = useState<CloudFile | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("Other");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<CloudFile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<UploadedFileReview[]>([]);
  const [reviewCategory, setReviewCategory] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [seenMessengerFiles, setSeenMessengerFiles] = useState<Set<string> | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const review = reviewQueue[0] ?? null;
  const reviewFile = review?.file ?? null;

  useEffect(() => {
    const loadSeenFiles = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(SEEN_MESSENGER_FILES_KEY);
        const ids: unknown = stored ? JSON.parse(stored) : [];
        setSeenMessengerFiles(new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []));
      } catch {
        setSeenMessengerFiles(new Set());
      }
    }, 0);
    return () => window.clearTimeout(loadSeenFiles);
  }, []);

  const newMessengerFiles = seenMessengerFiles
  ? files.filter((file) => !file.is_vaulted && !file.is_hidden && file.storage_path.includes("/messenger/") && !seenMessengerFiles.has(file.id))
    : [];

  function dismissMessengerNotice() {
    if (!seenMessengerFiles) return;
    const nextSeen = new Set(seenMessengerFiles);
    for (const file of newMessengerFiles) nextSeen.add(file.id);
    try {
      window.localStorage.setItem(SEEN_MESSENGER_FILES_KEY, JSON.stringify([...nextSeen].slice(-500)));
      setSeenMessengerFiles(nextSeen);
    } catch {
      setNotice("Could not save the notification state in this browser.");
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = files.filter((f) => {
      if (f.is_hidden) return false;
      if (category !== "All" && f.category !== category) return false;
      if (!q) return true;
      return [f.display_name, f.original_name, f.category].some((v) => v.toLowerCase().includes(q));
    });
    return matching.sort((a, b) => {
      if (sortBy === "least-recently-opened") {
        if (!a.last_accessed_at && b.last_accessed_at) return -1;
        if (a.last_accessed_at && !b.last_accessed_at) return 1;
        return (a.last_accessed_at ?? a.created_at).localeCompare(b.last_accessed_at ?? b.created_at);
      }
      if (sortBy === "most-recently-opened") return (b.last_accessed_at ?? "").localeCompare(a.last_accessed_at ?? "");
      return b.created_at.localeCompare(a.created_at);
    });
  }, [files, query, category, sortBy]);
  const chatcloudFiles = files.filter((file) => !file.is_hidden);

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setCategoryBusy(true);
    try {
      await createCategory(newCategory);
      setNewCategory("");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not create category.");
    } finally {
      setCategoryBusy(false);
    }
  }

  async function confirmDeleteCategory() {
    if (!deletingCategory) return;
    setDeleteCategoryBusy(true);
    try {
      await deleteCategory(deletingCategory);
      if (category === deletingCategory.name) setCategory("All");
      await refresh();
      await refreshCategories();
      setDeletingCategory(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not delete category.");
      setDeletingCategory(null);
    } finally {
      setDeleteCategoryBusy(false);
    }
  }

  async function open(file: CloudFile, download = false) {
    setNotice(null);
    // Open the tab first (inside the click) so pop-up blockers allow it, then point it at the file.
    const tab = download ? null : window.open("", "_blank");
    try {
      const url = await getSignedUrl(file, download);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      tab?.close();
      setNotice(err instanceof Error ? err.message : "Could not open the file");
    }
  }

  async function onPickFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setNotice(null);
    const picked = Array.from(list);
    const tooBig = picked.filter((f) => f.size > MAX_WEB_UPLOAD_BYTES);
    const ok = picked.filter((f) => f.size <= MAX_WEB_UPLOAD_BYTES);
    const problems = tooBig.map((f) => `${f.name}: over 4 MB`);
    try {
      if (ok.length > 0) {
      const { uploaded, failures } = await uploadFiles(ok);
      problems.push(...failures);
      if (uploaded.length > 0) {
        setReviewQueue(uploaded);
        setReviewCategory(uploaded[0].file.category);
          setReviewError(null);
        }
        await refreshCategories();
      }
    } catch (err) {
      problems.push(err instanceof Error ? err.message : "Upload failed");
    }
    if (problems.length > 0) setNotice(problems.join("\n"));
    if (fileInput.current) fileInput.current.value = "";
  }

  async function confirmSuggestedCategory() {
    if (!reviewFile) return;
    setReviewBusy(true);
    setReviewError(null);
    try {
      if (reviewCategory !== reviewFile.category) {
        await updateFile(reviewFile.id, {
          display_name: reviewFile.display_name,
          category: reviewCategory,
        });
        await refreshCategories();
      }
      const remaining = reviewQueue.slice(1);
      setReviewQueue(remaining);
      setReviewCategory(remaining[0]?.file.category ?? "");
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Could not update the category.");
    } finally {
      setReviewBusy(false);
    }
  }

  function closeReview() {
    if (reviewBusy) return;
    setReviewQueue([]);
    setReviewCategory("");
    setReviewError(null);
  }

  function startEdit(file: CloudFile) {
    setEditing(file);
    setEditName(file.display_name);
    setEditCategory(file.category);
    setFormError(null);
  }

  async function saveEdit() {
    if (!editing) return;
    const name = editName.trim();
    if (!name) return setFormError("Please enter a name.");
    setSaving(true);
    try {
      await updateFile(editing.id, { display_name: name, category: editCategory });
      if (editing.category !== editCategory) await refreshCategories();
      setEditing(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteFile(deleting);
      await refreshCategories();
      setDeleting(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not delete the file");
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function scanExistingFiles() {
    const scannableFiles = files.filter((file) => !file.is_vaulted && !file.is_hidden);
    if (scanning || scannableFiles.length === 0) return;
    setScanning(true);
    setScanMessage(null);
    let created = 0;
    let alreadyLinked = 0;
    let noDate = 0;
    const issues: string[] = [];

    try {
      for (const [index, file] of scannableFiles.entries()) {
        setScanProgress(`Analyzing ${index + 1} of ${scannableFiles.length}: ${file.display_name}`);
        try {
          const response = await fetch(`/api/chatcloud/files/${encodeURIComponent(file.id)}/analyze`, { method: "POST" });
          const result = await response.json() as {
            status?: "already-linked" | "no-date" | "renewal-created" | "unavailable";
            notice?: string;
            error?: string;
          };
          if (!response.ok) {
            issues.push(`${file.display_name}: ${result.error ?? "analysis failed"}`);
          } else if (result.status === "renewal-created") {
            created++;
          } else if (result.status === "already-linked") {
            alreadyLinked++;
          } else if (result.status === "no-date") {
            noDate++;
          } else {
            issues.push(`${file.display_name}: ${result.notice ?? "Gemini could not analyze this file."}`);
          }
        } catch (err) {
          issues.push(`${file.display_name}: ${err instanceof Error ? err.message : "request failed"}`);
        }
      }

      const issueSummary = issues.slice(0, 3).join(" ");
      const moreIssues = issues.length > 3 ? ` ${issues.length - 3} more issue(s).` : "";
      setScanMessage(
        `Scan complete: ${created} renewal(s) added, ${alreadyLinked} already linked, ${noDate} had no detected date, ${issues.length} could not be analyzed.${issueSummary ? ` ${issueSummary}` : ""}${moreIssues}`,
      );
    } finally {
      setScanning(false);
      setScanProgress("");
    }
  }

  const columns: Column<CloudFile>[] = [
    {
      key: "name",
      header: "Name",
      render: (f) => (
        <div className="flex items-center gap-3">
          <span className="text-xl">{categoryIcon(f.category)}</span>
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800">
              {f.display_name} {f.ai_status === "ai" && <span title="Named by AI" className="text-xs">✨</span>}
            </p>
            {f.is_vaulted && <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Locked in Personal Vault</span>}
            {f.storage_path.includes("/messenger/") && <span className="mt-1 inline-block rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Added via Messenger</span>}
            {f.original_name !== f.display_name && <p className="truncate text-xs text-slate-400">was: {f.original_name}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (f) => <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">{f.category}</span>,
    },
    { key: "size", header: "Size", className: "hidden md:table-cell", render: (f) => <span className="text-slate-600">{humanSize(f.size_bytes)}</span> },
    {
      key: "added",
      header: "Added",
      className: "hidden md:table-cell",
      render: (f) => (
        <span className="text-slate-600">
            {new Date(f.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (f) => (
        <div className="flex justify-end gap-1 text-sm">
          {f.is_vaulted ? (
            <span className="px-2 py-1 text-xs text-amber-800">Unlock in Security &amp; Vault</span>
          ) : (
            <>
              <button onClick={() => void open(f)} className="rounded px-2 py-1 text-indigo-600 hover:bg-indigo-50">Open</button>
              <button onClick={() => void open(f, true)} className="hidden rounded px-2 py-1 text-slate-600 hover:bg-slate-100 sm:block">Download</button>
              <button onClick={() => startEdit(f)} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100">Edit</button>
              <button onClick={() => setDeleting(f)} className="rounded px-2 py-1 text-red-600 hover:bg-red-50">Delete</button>
            </>
          )}
        </div>
      ),
    },
  ];

  const uploadButton = (
    <button onClick={() => fileInput.current?.click()} disabled={!!uploading} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
      {uploading ?? "⬆ Upload files"}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files…" className={`${inputClass} sm:max-w-xs`} aria-label="Search files" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputClass} sm:w-44`} aria-label="Filter by category">
          <option value="All">All categories</option>
          {categories.map((item) => (
            <option key={item.id} value={item.name}>{item.name}</option>
          ))}
        </select>
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} className={`${inputClass} sm:w-56`} aria-label="Sort files">
          <option value="newest">Newest first</option>
          <option value="least-recently-opened">Least recently opened</option>
          <option value="most-recently-opened">Most recently opened</option>
        </select>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => void scanExistingFiles()}
            disabled={scanning || files.every((file) => file.is_vaulted || file.is_hidden)}
            className="rounded-lg border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Find renewals in existing files"}
          </button>
          <button onClick={() => void refresh()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50" title="Reload">↻</button>
          {uploadButton}
        </div>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => void onPickFiles(e.target.files)} />
      </div>

      {(error || categoriesError || notice) && <p className="whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error ?? categoriesError ?? notice}</p>}
      {newMessengerFiles.length > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <p>
            <span className="font-semibold">New file{newMessengerFiles.length === 1 ? "" : "s"} added via Messenger:</span>{" "}
            {newMessengerFiles.slice(0, 3).map((file) => file.display_name).join(", ")}
            {newMessengerFiles.length > 3 ? ` and ${newMessengerFiles.length - 3} more` : ""}
          </p>
          <button type="button" onClick={dismissMessengerNotice} className="shrink-0 rounded border border-violet-300 px-3 py-1.5 font-medium hover:bg-violet-100">
            Dismiss
          </button>
        </div>
      )}
      {(scanProgress || scanMessage) && (
        <p role="status" className="whitespace-pre-line rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
          {scanProgress || scanMessage}
        </p>
      )}

      <section className="space-y-3" aria-label="File categories">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-800">Categories</h2>
            <p className="text-xs text-slate-500">Select a category to filter files. Deleting one moves its files to Other.</p>
          </div>
          <form onSubmit={(event) => void addCategory(event)} className="flex gap-2">
            <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New category" aria-label="New category name" maxLength={40} className={`${inputClass} sm:w-48`} />
            <button type="submit" disabled={categoryBusy || !newCategory.trim()} className="rounded-lg border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
              {categoryBusy ? "Adding…" : "Add"}
            </button>
          </form>
        </div>
        {categoriesLoading ? (
          <p className="text-sm text-slate-500">Loading categories…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {categories.map((item) => (
              <div key={item.id} className={`flex items-center gap-2 rounded-xl border p-3 ${category === item.name ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white"}`}>
                <button onClick={() => setCategory(category === item.name ? "All" : item.name)} className="min-w-0 flex-1 text-left">
                  <span className="text-xl">{categoryIcon(item.name)}</span>
                  <span className="mt-1 block truncate text-sm font-medium text-slate-800">{item.name}</span>
                  <span className="text-xs text-slate-500">{files.filter((file) => !file.is_hidden && file.category === item.name).length} files</span>
                </button>
                {item.name.toLowerCase() !== "other" && (
                  <button onClick={() => setDeletingCategory(item)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title={`Delete ${item.name}`} aria-label={`Delete ${item.name} category`}>×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-500">Loading your files…</p>
      ) : chatcloudFiles.length === 0 && files.length > 0 ? (
        <EmptyState icon="🔒" title="Files are hidden" description="Your files are hidden from this list. Manage their visibility in Security & Vault." />
      ) : files.length === 0 ? (
        <EmptyState
          icon="📁"
          title="No files yet"
          description="Upload a file here. It will be named and sorted automatically."
          action={uploadButton}
        />
      ) : visible.length === 0 ? (
        <EmptyState icon="🔍" title="No matches" description="Try a different search or category." />
      ) : (
        <DataTable columns={columns} rows={visible} rowKey={(f) => f.id} />
      )}

      <FormModal open={!!editing} title="Edit file" onClose={() => setEditing(null)} onSubmit={saveEdit} busy={saving} error={formError}>
        <label className="block text-sm font-medium text-slate-700">
          Name
          <input value={editName} onChange={(e) => setEditName(e.target.value)} className={`${inputClass} mt-1`} maxLength={120} autoFocus />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Category
          <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className={`${inputClass} mt-1`}>
            {categories.map((item) => (
              <option key={item.id} value={item.name}>{item.name}</option>
            ))}
          </select>
        </label>
      </FormModal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete this file?"
        message={`"${deleting?.display_name ?? ""}" will be permanently removed. Any renewal linked to it will stay, but lose the link.`}
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={!!deletingCategory}
        title="Delete this category?"
        message={`Files and renewals in "${deletingCategory?.name ?? ""}" will be moved to Other. The files themselves will not be deleted.`}
        confirmLabel="Delete category"
        destructive
        busy={deleteCategoryBusy}
        onConfirm={confirmDeleteCategory}
        onCancel={() => setDeletingCategory(null)}
      />
      {reviewFile && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="category-review-title" className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <p className="text-sm font-medium text-indigo-700">Upload review {reviewQueue.length > 1 ? `· ${reviewQueue.length} files left` : ""}</p>
            <h2 id="category-review-title" className="mt-1 text-lg font-semibold text-slate-900">Does this category look right?</h2>
            <p className="mt-2 text-sm text-slate-600">
              {reviewFile.ai_status === "ai" ? "The AI suggests" : "Suggested name and category:"}
              {" "}<strong>{reviewFile.display_name}</strong> as a <strong>{reviewFile.category}</strong> document.
            </p>
            {review?.aiIdentification && <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">{review.aiIdentification}</p>}
            {review?.aiNotice && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{review.aiNotice}</p>}
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Save it under
              <select value={reviewCategory} onChange={(event) => setReviewCategory(event.target.value)} className={`${inputClass} mt-1`}>
                {categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
            </label>
            {reviewError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{reviewError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={closeReview} disabled={reviewBusy} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                Continue with suggestion
              </button>
              <button type="button" onClick={() => void confirmSuggestedCategory()} disabled={reviewBusy || !reviewCategory} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                {reviewBusy ? "Saving…" : reviewCategory === reviewFile.category ? "Confirm category" : "Save category"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
