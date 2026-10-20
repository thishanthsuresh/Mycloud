"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChatcloudCategory } from "@/types/chatcloud";

export function useChatcloudCategories() {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<ChatcloudCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/chatcloud/categories");
      const json = (await res.json().catch(() => ({}))) as { categories?: ChatcloudCategory[]; error?: string };
      if (!res.ok) setError(json.error ?? "Could not load categories.");
      else {
        setCategories(json.categories ?? []);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load categories.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const load = setTimeout(() => void refresh(), 0);
    const channel = supabase
      .channel("chatcloud-category-counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "cloud_files" }, () => void refresh())
      .subscribe();
    return () => {
      clearTimeout(load);
      void supabase.removeChannel(channel);
    };
  }, [supabase, refresh]);

  const createCategory = useCallback(async (name: string) => {
    const res = await fetch("/api/chatcloud/categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = (await res.json().catch(() => ({}))) as { category?: ChatcloudCategory; error?: string };
    if (!res.ok || !json.category) throw new Error(json.error ?? "Could not create category.");
    const created = json.category;
    setCategories((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  const deleteCategory = useCallback(async (category: ChatcloudCategory) => {
    const res = await fetch("/api/chatcloud/categories", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: category.id }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Could not delete category.");
    setCategories((current) => current.filter((item) => item.id !== category.id));
  }, []);

  return { categories, loading, error, refresh, createCategory, deleteCategory };
}
