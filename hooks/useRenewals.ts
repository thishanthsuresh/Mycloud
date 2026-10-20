"use client";
// All database access for the Renewals tab.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addMonthsISO, localTodayISO } from "@/lib/chatcloud/utils";
import type { Renewal, RenewalInput } from "@/types/chatcloud";

export type FileOption = { id: string; display_name: string };

export function useRenewals() {
  const supabase = useMemo(() => createClient(), []);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [fileOptions, setFileOptions] = useState<FileOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [r, f] = await Promise.all([
      supabase.from("renewals").select("*").order("due_date", { ascending: true }).limit(500),
      supabase.from("cloud_files").select("id, display_name").eq("is_hidden", false).order("display_name", { ascending: true }).limit(500),
    ]);
    if (r.error) setError(r.error.message);
    else {
      setError(null);
      setRenewals(r.data as Renewal[]);
    }
    if (!f.error) setFileOptions(f.data as FileOption[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const load = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(load);
  }, [refresh]);

  const createRenewal = useCallback(
    async (input: RenewalInput) => {
      const { error } = await supabase.from("renewals").insert(input);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [supabase, refresh],
  );

  const updateRenewal = useCallback(
    async (id: string, input: RenewalInput) => {
      const { error } = await supabase.from("renewals").update(input).eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [supabase, refresh],
  );

  const deleteRenewal = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("renewals").delete().eq("id", id);
      if (error) throw new Error(error.message);
      setRenewals((prev) => prev.filter((r) => r.id !== id));
    },
    [supabase],
  );

  /** Repeating renewals move to the next due date; one-time renewals are archived as "renewed". */
  const markRenewed = useCallback(
    async (renewal: Renewal) => {
      let changes: Partial<Renewal>;
      if (renewal.repeat_months) {
        let next = addMonthsISO(renewal.due_date, renewal.repeat_months);
        const today = localTodayISO();
        while (next < today) next = addMonthsISO(next, renewal.repeat_months);
        const previousReminder = renewal.remind_at ? new Date(renewal.remind_at) : new Date(`${renewal.due_date}T09:00:00.000Z`);
        const nextReminderDate = new Date(`${next}T00:00:00.000Z`);
        nextReminderDate.setUTCDate(nextReminderDate.getUTCDate() - renewal.remind_days_before);
        nextReminderDate.setUTCHours(previousReminder.getUTCHours(), previousReminder.getUTCMinutes(), 0, 0);
        changes = { due_date: next, remind_at: nextReminderDate.toISOString() };
      } else {
        changes = { status: "renewed" };
      }
      const { error } = await supabase.from("renewals").update(changes).eq("id", renewal.id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [supabase, refresh],
  );

  return { renewals, fileOptions, loading, error, refresh, createRenewal, updateRenewal, deleteRenewal, markRenewed };
}
