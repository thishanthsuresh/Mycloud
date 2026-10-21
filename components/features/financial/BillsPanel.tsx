"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Bill = {
  id: string;
  vendor: string;
  amount: number | string;
  category: string;
  attachment_name: string | null;
  attachment_size: number | null;
  attachmentUrl: string | null;
  created_at: string;
};

type ApiError = { error?: string };

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const CATEGORIES = ["Housing", "Utilities", "Groceries", "Healthcare", "Transport", "Subscriptions", "Other"];
const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
  return result;
}

function money(value: number | string) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

export default function BillsPanel() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Utilities");
  const [file, setFile] = useState<File | null>(null);
  const [allowGeminiScan, setAllowGeminiScan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadBills = useCallback(async () => {
    try {
      const result = await requestJson<{ bills: Bill[] }>("/api/financial/bills");
      setBills(result.bills);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load bills.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadBills(), 0);
    return () => window.clearTimeout(timer);
  }, [loadBills]);

  function chooseFile(nextFile: File | null) {
    setFile(nextFile);
    setAllowGeminiScan(false);
    setNotice(null);
    if (nextFile && nextFile.size > MAX_FILE_BYTES) {
      setError("Bill files must be 4 MB or smaller.");
    } else {
      setError(null);
    }
  }

  async function scanBill() {
    if (!file || !allowGeminiScan || scanning || file.size > MAX_FILE_BYTES) return;
    setScanning(true);
    setError(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("consent", "true");
      const result = await requestJson<{ vendor: string; amount: number | null; category: string; message: string }>(
        "/api/financial/bills/scan",
        { method: "POST", body },
      );
      if (result.vendor) setVendor(result.vendor);
      if (result.amount !== null) setAmount(String(result.amount));
      if (CATEGORIES.includes(result.category)) setCategory(result.category);
      setNotice(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not scan this bill.");
    } finally {
      setScanning(false);
    }
  }

  async function saveBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("vendor", vendor.trim());
      body.set("amount", amount);
      body.set("category", category);
      if (file) body.set("file", file);
      await requestJson<{ bill: Bill }>("/api/financial/bills", { method: "POST", body });
      setVendor("");
      setAmount("");
      setCategory("Utilities");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await loadBills();
      setNotice("Bill saved to your private expense tracker.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this bill.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteBill(bill: Bill) {
    if (deletingId) return;
    if (!window.confirm(`Delete the bill from ${bill.vendor}? This also removes its attachment.`)) return;
    setDeletingId(bill.id);
    setError(null);
    setNotice(null);
    try {
      await requestJson(`/api/financial/bills/${encodeURIComponent(bill.id)}`, { method: "DELETE" });
      setBills((current) => current.filter((item) => item.id !== bill.id));
      setNotice("Bill deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this bill.");
    } finally {
      setDeletingId(null);
    }
  }

  const total = bills.reduce((sum, bill) => sum + Number(bill.amount), 0);

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Bills and expenses</h2>
        <p className="mt-1 text-sm text-slate-500">Upload a bill image or PDF, scan it to fill in the details, then review and save it privately.</p>
      </header>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      <form onSubmit={(event) => void saveBill(event)} className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Vendor / biller
          <input required maxLength={160} value={vendor} onChange={(event) => setVendor(event.target.value)} className={`${inputClass} mt-1`} placeholder="Electricity company" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Amount
          <input required type="number" min="0.01" max="9999999999.99" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className={`${inputClass} mt-1`} placeholder="0.00" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Expense category
          <select value={category} onChange={(event) => setCategory(event.target.value)} className={`${inputClass} mt-1`}>
            {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Bill image or PDF <span className="font-normal text-slate-500">(optional, up to 4 MB)</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            className={`${inputClass} mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700`}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          {file && (
            <label className="flex w-full items-start gap-2 text-xs leading-5 text-slate-600">
              <input type="checkbox" checked={allowGeminiScan} onChange={(event) => setAllowGeminiScan(event.target.checked)} className="mt-1" />
              Send this bill image/PDF to the configured Google Gemini service to extract its details.
            </label>
          )}
          {file && <button type="button" onClick={() => void scanBill()} disabled={!allowGeminiScan || scanning || saving || file.size > MAX_FILE_BYTES} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
            {scanning ? "Scanning bill…" : "Scan bill with OCR"}
          </button>}
          <button type="submit" disabled={saving || scanning || !vendor.trim() || !amount} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Saving…" : "Save bill"}
          </button>
          <span className="text-xs text-slate-500">Check scanned details before saving. Amounts are shown without a currency symbol.</span>
        </div>
      </form>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Expense history</h3>
          <p className="mt-1 text-sm text-slate-500">{bills.length} {bills.length === 1 ? "bill" : "bills"} recorded</p>
        </div>
        <p className="text-sm font-medium text-slate-700">Total recorded: <span className="text-lg font-bold text-slate-900">{money(total)}</span></p>
      </div>

      {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading bills…</p> : bills.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No bills yet. Add one above or open Bills from Messenger.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {bills.map((bill) => (
            <li key={bill.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{bill.vendor}</p>
                <p className="mt-1 text-xs text-slate-500">{bill.category} · {new Date(bill.created_at).toLocaleDateString()}</p>
                {bill.attachment_name && <p className="mt-1 truncate text-xs text-slate-500">{bill.attachment_name}</p>}
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-900">{money(bill.amount)}</span>
                {bill.attachmentUrl && <a href={bill.attachmentUrl} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-slate-50">View file</a>}
                <button type="button" onClick={() => void deleteBill(bill)} disabled={deletingId === bill.id} className="rounded-md px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                  {deletingId === bill.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
