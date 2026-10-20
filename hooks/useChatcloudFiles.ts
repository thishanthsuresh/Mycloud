"use client";
// All database/storage access for the Files tab lives here (components never talk to Supabase directly).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STORAGE_BUCKET } from "@/lib/chatcloud/constants";
import type { CloudFile } from "@/types/chatcloud";

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

export type UploadedFileReview = {
  file: CloudFile;
  aiIdentification: string | null;
  aiNotice: string | null;
};

export function useChatcloudFiles() {
  const supabase = useMemo(() => createClient(), []);
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null); // e.g. "Uploading 2 of 3…"

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("cloud_files")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) setError(error.message);
    else {
      setError(null);
      setFiles(data as CloudFile[]);
    }
    setLoading(false);
  }, [supabase]);

  // Load once, then reload whenever a cloud file row changes.
  useEffect(() => {
    const load = setTimeout(() => void refresh(), 0);
    const channel = supabase
      .channel("chatcloud-files")
      .on("postgres_changes", { event: "*", schema: "public", table: "cloud_files" }, () => void refresh())
      .subscribe();
    return () => {
      clearTimeout(load);
      void supabase.removeChannel(channel);
    };
  }, [supabase, refresh]);

  const updateFile = useCallback(
    async (id: string, changes: { display_name: string; category: string }) => {
      const { error } = await supabase.from("cloud_files").update(changes).eq("id", id);
      if (error) throw new Error(error.message);
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...changes } : f)));
    },
    [supabase],
  );

  const deleteFile = useCallback(
    async (file: CloudFile) => {
      const removed = await supabase.storage.from(STORAGE_BUCKET).remove([file.storage_path]);
      if (removed.error) throw new Error(removed.error.message);
      const { error } = await supabase.from("cloud_files").delete().eq("id", file.id);
      if (error) throw new Error(error.message);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    },
    [supabase],
  );

  /** A temporary (5 minute) link to open or download a private file. */
  const getSignedUrl = useCallback(
    async (file: CloudFile, download = false) => {
      const tracked = await fetch(`/api/chatcloud/files/${encodeURIComponent(file.id)}/access`, { method: "POST" });
      const trackingJson = (await tracked.json().catch(() => ({}))) as { error?: string };
      if (!tracked.ok) throw new Error(trackingJson.error ?? "Could not record file usage.");
      const accessedAt = new Date().toISOString();
      setFiles((current) => current.map((item) => item.id === file.id ? { ...item, last_accessed_at: accessedAt } : item));
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(file.storage_path, 300, download ? { download: file.display_name } : undefined);
      if (error || !data) throw new Error(error?.message ?? "Could not create a link for this file");
      return data.signedUrl;
    },
    [supabase],
  );

  /** Upload one or more files from the website. They go through the server so the AI can name them. */
  const uploadFiles = useCallback(
    async (list: File[]) => {
      const failures: string[] = [];
      const uploaded: UploadedFileReview[] = [];
      try {
        for (let i = 0; i < list.length; i++) {
          setUploading(`Uploading ${i + 1} of ${list.length}…`);
          const body = new FormData();
          body.append("file", list[i]);
          const res = await fetch("/api/chatcloud/upload", { method: "POST", body });
          if (!res.ok) {
            const json = (await res.json().catch(() => ({}))) as { error?: string };
            failures.push(`${list[i].name}: ${json.error ?? "upload failed"}`);
          } else {
            const json = (await res.json()) as UploadedFileReview;
            uploaded.push(json);
          }
        }
      } catch (err) {
        failures.push(message(err));
      } finally {
        setUploading(null);
        await refresh();
      }
      return { uploaded, failures };
    },
    [refresh],
  );

  return { files, loading, error, uploading, refresh, updateFile, deleteFile, getSignedUrl, uploadFiles };
}
