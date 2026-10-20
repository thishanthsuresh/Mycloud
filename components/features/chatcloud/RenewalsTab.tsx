"use client";
import { useMemo, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DataTable, { type Column } from "@/components/ui/DataTable";
import EmptyState from "@/components/ui/EmptyState";
import FormModal from "@/components/ui/FormModal";
import { useChatcloudCategories } from "@/hooks/useChatcloudCategories";
import { useRenewals } from "@/hooks/useRenewals";
import { addDaysISO, countdownText, daysUntil, localTodayISO } from "@/lib/chatcloud/utils";
import type { Renewal, RenewalInput } from "@/types/chatcloud";
import RenewalFields, { type RenewalFormValues } from "./RenewalFields";

const emptyForm = (): RenewalFormValues => ({
  title: "",
  category: "Other",
  due_date: addDaysISO(localTodayISO(), 30),
  remind_at: defaultReminderAt(addDaysISO(localTodayISO(), 30), 14),
  repeat_months: "",
  file_id: "",
  notes: "",
  status: "active",
});

function defaultReminderAt(dueDate: string, daysBefore: number) {
  const date = new Date(`${dueDate}T09:00:00`);
  date.setDate(date.getDate() - daysBefore);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateTime(value: string | null, dueDate: string, daysBefore: number) {
  if (!value) return defaultReminderAt(dueDate, daysBefore);
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const fromRenewal = (r: Renewal): RenewalFormValues => ({
  title: r.title,
  category: r.category,
  due_date: r.due_date,
  remind_at: localDateTime(r.remind_at, r.due_date, r.remind_days_before),
  repeat_months: r.repeat_months ? String(r.repeat_months) : "",
  file_id: r.file_id ?? "",
  notes: r.notes ?? "",
  status: r.status,
});

function chipFor(r: Renewal, today: string) {
  if (r.status === "renewed") return { text: "Renewed", cls: "bg-emerald-100 text-emerald-700" };
  const left = daysUntil(r.due_date, today);
  const text = countdownText(left);
  if (left < 0) return { text, cls: "bg-red-100 text-red-700" };
  if (left <= r.remind_days_before) return { text, cls: "bg-amber-100 text-amber-700" };
  return { text, cls: "bg-slate-100 text-slate-600" };
}

export default function RenewalsTab() {
  const { renewals, fileOptions, loading, error, createRenewal, updateRenewal, deleteRenewal, markRenewed } = useRenewals();
  const { categories, error: categoryError } = useChatcloudCategories();

  const [showRenewed, setShowRenewed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RenewalFormValues>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<Renewal | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fileName = useMemo(() => new Map(fileOptions.map((f) => [f.id, f.display_name])), [fileOptions]);
  const visible = useMemo(() => renewals.filter((r) => showRenewed || r.status === "active"), [renewals, showRenewed]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(r: Renewal) {
    setEditingId(r.id);
    setForm(fromRenewal(r));
    setFormError(null);
    setFormOpen(true);
  }

  async function save() {
    const title = form.title.trim();
    if (!title) return setFormError("Please enter a title.");
    if (!form.due_date) return setFormError("Please pick a due date.");
    if (!form.remind_at) return setFormError("Please choose when to be reminded.");
    const reminderTime = new Date(form.remind_at);
    if (!Number.isFinite(reminderTime.getTime())) return setFormError("Please choose a valid reminder date and time.");
    if (reminderTime.getTime() <= Date.now()) return setFormError("Choose a reminder time in the future.");
    const daysBefore = daysUntil(form.due_date, form.remind_at.slice(0, 10));
    if (daysBefore < 0 || daysBefore > 365) return setFormError("Choose a reminder time on or before the due date, within 365 days.");

    const input: RenewalInput = {
      title,
      category: form.category,
      due_date: form.due_date,
      remind_days_before: daysBefore,
      remind_at: new Date(form.remind_at).toISOString(),
      repeat_months: form.repeat_months ? Number(form.repeat_months) : null,
      file_id: form.file_id || null,
      notes: form.notes.trim() || null,
      status: form.status,
    };
    setSaving(true);
    try {
      if (editingId) await updateRenewal(editingId, input);
      else await createRenewal(input);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function renew(r: Renewal) {
    setNotice(null);
    try {
      await markRenewed(r);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not update the renewal");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteRenewal(deleting.id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
    }
  }

  const today = localTodayISO();
  const columns: Column<Renewal>[] = [
    {
      key: "title",
      header: "Renewal",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{r.title}</p>
          <p className="truncate text-xs text-slate-400">
            {r.category}
            {r.file_id && fileName.get(r.file_id) ? ` · 📎 ${fileName.get(r.file_id)}` : ""}
            {r.repeat_months ? ` · repeats every ${r.repeat_months === 12 ? "year" : `${r.repeat_months} mo`}` : ""}
          </p>
        </div>
      ),
    },
    { key: "due", header: "Due", render: (r) => <span className="whitespace-nowrap text-slate-600">{r.due_date}</span> },
    {
      key: "reminder",
      header: "Reminder",
      render: (r) => (
        <span className="whitespace-nowrap text-slate-600">
          {r.remind_at ? new Date(r.remind_at).toLocaleString() : "Not scheduled"}
        </span>
      ),
    },
    {
      key: "left",
      header: "Status",
      render: (r) => {
        const chip = chipFor(r, today);
        return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${chip.cls}`}>{chip.text}</span>;
      },
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex justify-end gap-1 text-sm">
          {r.status === "active" && (
            <button onClick={() => void renew(r)} className="whitespace-nowrap rounded px-2 py-1 text-emerald-700 hover:bg-emerald-50">✓ Renewed</button>
          )}
          <button onClick={() => openEdit(r)} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100">Edit</button>
          <button onClick={() => setDeleting(r)} className="rounded px-2 py-1 text-red-600 hover:bg-red-50">Delete</button>
        </div>
      ),
    },
  ];

  const addButton = (
    <button onClick={openCreate} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
      + Add renewal
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showRenewed} onChange={(e) => setShowRenewed(e.target.checked)} />
          Show renewed
        </label>
        <div className="ml-auto">{addButton}</div>
      </div>

      {(error || categoryError || notice) && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error ?? categoryError ?? notice}</p>}

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-500">Loading renewals…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📅"
          title="No renewals yet"
          description="Add things that expire or need renewing: insurance, a passport, a licence, a subscription. If an uploaded file shows a renewal date, it will be added here for you."
          action={addButton}
        />
      ) : (
        <DataTable columns={columns} rows={visible} rowKey={(r) => r.id} />
      )}

      <FormModal open={formOpen} title={editingId ? "Edit renewal" : "Add renewal"} onClose={() => setFormOpen(false)} onSubmit={save} busy={saving} error={formError}>
        <RenewalFields values={form} onChange={setForm} files={fileOptions} categories={categories.map((category) => category.name)} showStatus={!!editingId} />
      </FormModal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete this renewal?"
        message={`"${deleting?.title ?? ""}" will be removed. The linked file (if any) is not deleted.`}
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
