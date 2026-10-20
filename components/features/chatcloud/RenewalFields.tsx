"use client";
// The form fields for adding/editing a renewal. The parent owns the values and the Save button.
import type { FileOption } from "@/hooks/useRenewals";

export type RenewalFormValues = {
  title: string;
  category: string;
  due_date: string;
  remind_at: string;
  repeat_months: string; // "" = one-time
  file_id: string; // "" = none
  notes: string;
  status: "active" | "renewed";
};

const inputClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
const labelClass = "block text-sm font-medium text-slate-700";

const REPEAT_OPTIONS = [
  { value: "", label: "One-time (no repeat)" },
  { value: "1", label: "Every month" },
  { value: "3", label: "Every 3 months" },
  { value: "6", label: "Every 6 months" },
  { value: "12", label: "Every year" },
  { value: "24", label: "Every 2 years" },
];

type Props = {
  values: RenewalFormValues;
  onChange: (next: RenewalFormValues) => void;
  files: FileOption[];
  categories: string[];
  showStatus: boolean;
};

export default function RenewalFields({ values, onChange, files, categories, showStatus }: Props) {
  const set = <K extends keyof RenewalFormValues>(key: K, value: RenewalFormValues[K]) => onChange({ ...values, [key]: value });

  return (
    <>
      <label className={labelClass}>
        Title
        <input value={values.title} onChange={(e) => set("title", e.target.value)} className={inputClass} placeholder="e.g. Car insurance" maxLength={120} autoFocus required />
      </label>
      <label className={labelClass}>
        Due date
        <input type="date" value={values.due_date} onChange={(e) => set("due_date", e.target.value)} className={inputClass} required />
      </label>
      <label className={labelClass}>
        Reminder date and time (local time)
        <input type="datetime-local" value={values.remind_at} onChange={(e) => set("remind_at", e.target.value)} className={inputClass} required />
        <span className="mt-1 block text-xs font-normal text-slate-500">The schedule is saved, but email reminders are not enabled yet.</span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Category
          <select value={values.category} onChange={(e) => set("category", e.target.value)} className={inputClass}>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Repeats
          <select value={values.repeat_months} onChange={(e) => set("repeat_months", e.target.value)} className={inputClass}>
            {REPEAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={labelClass}>
        Linked file (optional)
        <select value={values.file_id} onChange={(e) => set("file_id", e.target.value)} className={inputClass}>
          <option value="">None</option>
          {files.map((f) => (
            <option key={f.id} value={f.id}>{f.display_name}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Notes (optional)
        <textarea value={values.notes} onChange={(e) => set("notes", e.target.value)} className={inputClass} rows={2} maxLength={500} />
      </label>
      {showStatus && (
        <label className={labelClass}>
          Status
          <select value={values.status} onChange={(e) => set("status", e.target.value as "active" | "renewed")} className={inputClass}>
            <option value="active">Active</option>
            <option value="renewed">Renewed (archived)</option>
          </select>
        </label>
      )}
    </>
  );
}
