"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

type PendingBill = {
  file: File;
  vendor: string;
  amount: string;
  category: string;
  scanMessage: string;
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

function formatSize(value: number) {
  return value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BillsChat() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [pending, setPending] = useState<PendingBill | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [allowGeminiScan, setAllowGeminiScan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messagePane = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const pane = messagePane.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [bills, pending]);

  function chooseFile(file: File | null) {
    setError(null);
    setNotice(null);
    setAllowGeminiScan(false);
    if (file && file.size > MAX_FILE_BYTES) {
      setSelectedFile(null);
      setError("Bill files must be 4 MB or smaller.");
      return;
    }
    setSelectedFile(file);
  }

  async function sendBill() {
    if (!selectedFile || sending || pending) return;
    const file = selectedFile;
    setSending(true);
    setError(null);
    setNotice(null);
    setPending({
      file,
      vendor: "",
      amount: "",
      category: "Other",
      scanMessage: allowGeminiScan
        ? "Bill sent. Scanning the attachment…"
        : "Bill added to this chat. Enter the details below to add it to your expense tracker.",
    });
    setSelectedFile(null);
    if (fileInput.current) fileInput.current.value = "";

    try {
      if (allowGeminiScan) {
        const body = new FormData();
        body.set("file", file);
        body.set("consent", "true");
        const result = await requestJson<{
          vendor: string;
          amount: number | null;
          category: string;
          message: string;
        }>("/api/financial/bills/scan", { method: "POST", body });
        setPending((current) => current?.file === file ? {
          ...current,
          vendor: result.vendor,
          amount: result.amount === null ? "" : String(result.amount),
          category: CATEGORIES.includes(result.category) ? result.category : "Other",
          scanMessage: result.message,
        } : current);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not scan this bill.";
      setPending((current) => current?.file === file
        ? { ...current, scanMessage: `${message} Enter the details manually to continue.` }
        : current);
    } finally {
      setSending(false);
    }
  }

  async function saveBill() {
    if (!pending || saving || !pending.vendor.trim() || !pending.amount) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("vendor", pending.vendor.trim());
      body.set("amount", pending.amount);
      body.set("category", pending.category);
      body.set("file", pending.file);
      await requestJson<{ bill: Bill }>("/api/financial/bills", { method: "POST", body });
      setPending(null);
      await loadBills();
      setNotice("Bill saved to your expense tracker.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this bill.");
    } finally {
      setSaving(false);
    }
  }

  function cancelPending() {
    if (sending || saving) return;
    setPending(null);
    setNotice(null);
    setError(null);
  }

  const total = bills.reduce((sum, bill) => sum + Number(bill.amount), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100">🧾</span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900">Bills</h3>
            <p className="truncate text-xs text-slate-500">Private bill chat · expenses recorded: {money(total)}</p>
          </div>
        </div>
        <a href="/financial/bills" className="shrink-0 text-xs font-medium text-indigo-700 hover:underline">Expense tracker</a>
      </header>

      {(error || notice) && (
        <div className="border-b border-slate-200 px-4 py-2">
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        </div>
      )}

      <div ref={messagePane} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading bills…</p>
        ) : bills.length === 0 && !pending ? (
          <div className="mx-auto max-w-sm py-10 text-center">
            <p className="text-3xl">🧾</p>
            <p className="mt-3 text-sm font-medium text-slate-800">Send a bill to get started</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">Upload an image or PDF below. Scanned details can be reviewed here and saved directly to your private expense tracker.</p>
          </div>
        ) : (
          bills.slice().reverse().map((bill) => (
            <article key={bill.id} className="flex justify-end">
              <div className="max-w-[90%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-white shadow-sm">
                <p className="text-sm font-medium">{bill.vendor}</p>
                <p className="mt-1 text-sm">{bill.category} · {money(bill.amount)}</p>
                {bill.attachmentUrl && (
                  <a href={bill.attachmentUrl} target="_blank" rel="noreferrer" className="mt-2 block rounded-lg bg-indigo-700 px-3 py-2 text-xs underline">
                    📎 {bill.attachment_name ?? "View bill"}
                    {bill.attachment_size !== null && ` · ${formatSize(bill.attachment_size)}`}
                  </a>
                )}
                <p className="mt-1 text-right text-[10px] text-indigo-100">
                  Added to expenses · {new Date(bill.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                </p>
              </div>
            </article>
          ))
        )}

        {pending && (
          <article className="flex justify-end">
            <div className="w-full max-w-md rounded-2xl rounded-br-sm bg-indigo-600 p-3 text-white shadow-sm">
              <p className="text-sm font-medium">Bill attachment</p>
              <p className="mt-1 truncate text-xs text-indigo-100">{pending.file.name} · {formatSize(pending.file.size)}</p>
              <p className="mt-2 text-xs text-indigo-100">{pending.scanMessage}</p>
              <div className="mt-3 space-y-3 rounded-xl bg-white p-3 text-slate-800">
                <label className="block text-xs font-medium">
                  Vendor / biller
                  <input value={pending.vendor} maxLength={160} onChange={(event) => setPending({ ...pending, vendor: event.target.value })} className={`${inputClass} mt-1`} placeholder="Enter vendor" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs font-medium">
                    Amount
                    <input type="number" min="0.01" max="9999999999.99" step="0.01" value={pending.amount} onChange={(event) => setPending({ ...pending, amount: event.target.value })} className={`${inputClass} mt-1`} placeholder="0.00" />
                  </label>
                  <label className="block text-xs font-medium">
                    Category
                    <select value={pending.category} onChange={(event) => setPending({ ...pending, category: event.target.value })} className={`${inputClass} mt-1`}>
                      {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void saveBill()} disabled={saving || sending || !pending.vendor.trim() || !pending.amount} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                    {saving ? "Saving expense…" : "Add to expense tracker"}
                  </button>
                  <button type="button" onClick={cancelPending} disabled={sending || saving} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                </div>
              </div>
            </div>
          </article>
        )}
      </div>

      <div className="border-t border-slate-200 p-3">
        {selectedFile && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
            <span className="truncate">{selectedFile.name} · {formatSize(selectedFile.size)}</span>
            <button type="button" onClick={() => chooseFile(null)} className="ml-3 font-medium text-slate-700 hover:text-red-600">Remove</button>
          </div>
        )}
        <label className="mb-2 flex items-start gap-2 text-xs leading-5 text-slate-600">
          <input type="checkbox" checked={allowGeminiScan} onChange={(event) => setAllowGeminiScan(event.target.checked)} disabled={!selectedFile || !!pending} className="mt-1" />
          Send this bill to Google Gemini to scan vendor, amount, and category. You can enter the details manually if unchecked or scanning fails.
        </label>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="min-w-0 flex-1 text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700"
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            disabled={sending || saving || !!pending}
          />
          <button type="button" onClick={() => void sendBill()} disabled={!selectedFile || sending || saving || !!pending} className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
            {sending ? "Scanning…" : "Send bill"}
          </button>
        </div>
        <p className="mt-1 text-right text-[10px] text-slate-400">Images and PDFs up to 4 MB · Only saved after you confirm details</p>
      </div>
    </div>
  );
}
