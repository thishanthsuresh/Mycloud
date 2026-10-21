"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Goal = {
  id: string;
  name: string;
  target_amount: number | string;
  saved_amount: number | string;
  target_date: string | null;
  created_at: string;
};

type ApiError = { error?: string };

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

export default function GoalsPanel() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [savedInputs, setSavedInputs] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [savedAmount, setSavedAmount] = useState("0");
  const [targetDate, setTargetDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadGoals = useCallback(async () => {
    try {
      const result = await requestJson<{ goals: Goal[] }>("/api/financial/goals");
      setGoals(result.goals);
      setSavedInputs(Object.fromEntries(result.goals.map((goal) => [goal.id, String(goal.saved_amount)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load savings goals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadGoals(), 0);
    return () => window.clearTimeout(timer);
  }, [loadGoals]);

  async function addGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson<{ goal: Goal }>("/api/financial/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, targetAmount, savedAmount, targetDate }),
      });
      setName("");
      setTargetAmount("");
      setSavedAmount("0");
      setTargetDate("");
      await loadGoals();
      setNotice("Savings goal created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create this savings goal.");
    } finally {
      setSaving(false);
    }
  }

  async function updateSavedAmount(goal: Goal) {
    if (busyId) return;
    setBusyId(goal.id);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<{ goal: Goal }>(`/api/financial/goals/${encodeURIComponent(goal.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savedAmount: savedInputs[goal.id] }),
      });
      setGoals((current) => current.map((item) => item.id === goal.id ? result.goal : item));
      setSavedInputs((current) => ({ ...current, [goal.id]: String(result.goal.saved_amount) }));
      setNotice(`Progress for “${goal.name}” updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update savings progress.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteGoal(goal: Goal) {
    if (busyId) return;
    if (!window.confirm(`Delete the “${goal.name}” savings goal?`)) return;
    setBusyId(goal.id);
    setError(null);
    setNotice(null);
    try {
      await requestJson(`/api/financial/goals/${encodeURIComponent(goal.id)}`, { method: "DELETE" });
      setGoals((current) => current.filter((item) => item.id !== goal.id));
      setNotice("Savings goal deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this savings goal.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Savings goals</h2>
        <p className="mt-1 text-sm text-slate-500">Set a target and update how much you have saved as you make progress.</p>
      </header>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      <form onSubmit={(event) => void addGoal(event)} className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Goal name
          <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className={`${inputClass} mt-1`} placeholder="Emergency fund" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Target amount
          <input required type="number" min="0.01" max="9999999999.99" step="0.01" value={targetAmount} onChange={(event) => setTargetAmount(event.target.value)} className={`${inputClass} mt-1`} placeholder="0.00" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Already saved
          <input type="number" min="0" max="9999999999.99" step="0.01" value={savedAmount} onChange={(event) => setSavedAmount(event.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Target date <span className="font-normal text-slate-500">(optional)</span>
          <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <button type="submit" disabled={saving || !name.trim() || !targetAmount} className="w-fit rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 md:col-span-2">
          {saving ? "Creating…" : "Create savings goal"}
        </button>
      </form>

      {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading goals…</p> : goals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Your savings goals will appear here.</p>
      ) : (
        <ul className="space-y-3">
          {goals.map((goal) => {
            const target = Number(goal.target_amount);
            const saved = Number(goal.saved_amount);
            const progress = Math.min(100, target > 0 ? (saved / target) * 100 : 0);
            return (
              <li key={goal.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">{goal.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">Saved {money(goal.saved_amount)} of {money(goal.target_amount)}</p>
                    {goal.target_date && <p className="mt-1 text-xs text-slate-500">Target date: {new Date(`${goal.target_date}T00:00:00`).toLocaleDateString()}</p>}
                  </div>
                  <button type="button" onClick={() => void deleteGoal(goal)} disabled={busyId === goal.id} className="rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                    {busyId === goal.id ? "Working…" : "Delete"}
                  </button>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label={`${goal.name} progress`}>
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <form onSubmit={(event) => { event.preventDefault(); void updateSavedAmount(goal); }} className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="min-w-40 flex-1 text-xs font-medium text-slate-600">
                    Update amount saved
                    <input type="number" min="0" max="9999999999.99" step="0.01" value={savedInputs[goal.id] ?? ""} onChange={(event) => setSavedInputs((current) => ({ ...current, [goal.id]: event.target.value }))} className={`${inputClass} mt-1`} />
                  </label>
                  <button type="submit" disabled={busyId === goal.id} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Update progress</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
