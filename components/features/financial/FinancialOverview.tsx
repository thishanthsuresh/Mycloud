"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Goal = { id: string; name: string; target_amount: number | string; saved_amount: number | string };
type Bill = { id: string; amount: number | string; category: string; created_at: string };
type ApiError = { error?: string };
type MonthTotal = { key: string; label: string; amount: number };

const CATEGORY_COLORS = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-sky-500",
  "bg-fuchsia-500",
  "bg-rose-500",
  "bg-slate-400",
];

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const result = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
  return result;
}

function money(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function lastSixMonths(): MonthTotal[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date),
      amount: 0,
    };
  });
}

export default function FinancialOverview() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [months, setMonths] = useState<MonthTotal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setMonths(lastSixMonths());
      void Promise.all([
        requestJson<{ bills: Bill[] }>("/api/financial/bills"),
        requestJson<{ goals: Goal[] }>("/api/financial/goals"),
      ]).then(([billResult, goalResult]) => {
        if (!active) return;
        setBills(billResult.bills);
        setGoals(goalResult.goals);
      }).catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load your financial summary.");
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const totalSpent = bills.reduce((sum, bill) => sum + Number(bill.amount), 0);
  const totalSaved = goals.reduce((sum, goal) => sum + Number(goal.saved_amount), 0);
  const totalTargets = goals.reduce((sum, goal) => sum + Number(goal.target_amount), 0);
  const overallProgress = totalTargets > 0 ? Math.min(100, (totalSaved / totalTargets) * 100) : 0;

  const monthByKey = new Map(months.map((month) => [month.key, month]));
  for (const bill of bills) {
    const date = new Date(bill.created_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const month = monthByKey.get(key);
    if (month) month.amount += Number(bill.amount) || 0;
  }
  const maxMonthAmount = Math.max(...months.map((month) => month.amount), 0);

  const categoryTotals = new Map<string, number>();
  for (const bill of bills) {
    categoryTotals.set(bill.category, (categoryTotals.get(bill.category) ?? 0) + (Number(bill.amount) || 0));
  }
  const categories = [...categoryTotals.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((left, right) => right.amount - left.amount);
  const largestCategoryAmount = categories[0]?.amount ?? 0;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Your money, at a glance</h2>
          <p className="mt-1 text-sm text-slate-500">A clear picture of recorded expenses and savings progress.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/financial/bills" className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">+ Add a bill</Link>
        </div>
      </header>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading your financial summary…</p> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 p-5 text-white shadow-sm">
              <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10" />
              <p className="relative text-sm font-medium text-indigo-100">Total recorded expenses</p>
              <p className="relative mt-2 text-3xl font-bold tracking-tight">{money(totalSpent)}</p>
              <p className="relative mt-2 text-sm text-indigo-100">{bills.length} {bills.length === 1 ? "bill" : "bills"} tracked</p>
            </article>
            <article className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 p-5 text-white shadow-sm">
              <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10" />
              <p className="relative text-sm font-medium text-emerald-50">Savings in progress</p>
              <p className="relative mt-2 text-3xl font-bold tracking-tight">{money(totalSaved)}</p>
              <p className="relative mt-2 text-sm text-emerald-50">of {money(totalTargets)} across {goals.length} {goals.length === 1 ? "goal" : "goals"}</p>
              <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-black/20" role="progressbar" aria-valuenow={Math.round(overallProgress)} aria-valuemin={0} aria-valuemax={100} aria-label="Overall savings progress">
                <div className="h-full rounded-full bg-white transition-all" style={{ width: `${overallProgress}%` }} />
              </div>
            </article>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900">Monthly expenses</h3>
                  <p className="mt-1 text-xs text-slate-500">Recorded bills · last six months</p>
                </div>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">6 month view</span>
              </div>
              <div className="mt-5">
                {maxMonthAmount === 0 ? (
                  <div className="flex h-48 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500">Add bills to see your monthly trend.</div>
                ) : (
                  <div className="grid h-48 grid-cols-6 items-end gap-2 sm:gap-4" role="img" aria-label={`Monthly expenses for the last six months. Highest month: ${money(maxMonthAmount)}.`}>
                    {months.map((month) => {
                      const height = month.amount > 0 ? Math.max(8, (month.amount / maxMonthAmount) * 100) : 0;
                      return (
                        <div key={month.key} className="flex h-full min-w-0 flex-col items-center justify-end gap-2">
                          <span className="max-w-full truncate text-[10px] font-medium text-slate-500">{month.amount > 0 ? money(month.amount) : ""}</span>
                          <div className="flex h-[68%] w-full items-end rounded-t-md bg-indigo-50">
                            {month.amount > 0 && <div className="w-full rounded-t-md bg-gradient-to-t from-indigo-600 to-violet-500 transition-all" style={{ height: `${height}%` }} title={`${month.label}: ${money(month.amount)}`} />}
                          </div>
                          <span className="text-xs font-medium text-slate-500">{month.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h3 className="font-semibold text-slate-900">Spending by category</h3>
                <p className="mt-1 text-xs text-slate-500">Where your recorded expenses go</p>
              </div>
              {categories.length === 0 ? (
                <div className="mt-5 flex h-40 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500">Your category breakdown will appear when you add bills.</div>
              ) : (
                <ul className="mt-5 space-y-4">
                  {categories.map((category, index) => {
                    const percent = largestCategoryAmount > 0 ? (category.amount / largestCategoryAmount) * 100 : 0;
                    return (
                      <li key={category.name}>
                        <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                          <span className="flex min-w-0 items-center gap-2 font-medium text-slate-700">
                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CATEGORY_COLORS[index % CATEGORY_COLORS.length]}`} />
                            <span className="truncate">{category.name}</span>
                          </span>
                          <span className="shrink-0 font-semibold text-slate-900">{money(category.amount)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${CATEGORY_COLORS[index % CATEGORY_COLORS.length]} transition-all`} style={{ width: `${percent}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          </div>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-slate-900">Savings goals</h3>
                <p className="mt-1 text-xs text-slate-500">Progress toward each target</p>
              </div>
              <Link href="/financial" className="text-sm font-semibold text-indigo-700 hover:underline">Manage goals →</Link>
            </div>
            {goals.length === 0 ? (
              <p className="mt-5 rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">Create a savings goal to see your progress here.</p>
            ) : (
              <ul className="mt-5 grid gap-4 md:grid-cols-2">
                {goals.map((goal, index) => {
                  const target = Number(goal.target_amount);
                  const saved = Number(goal.saved_amount);
                  const progress = target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : 0;
                  const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length];
                  return (
                    <li key={goal.id} className="rounded-xl bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-slate-800">{goal.name}</span>
                        <span className="shrink-0 text-xs font-bold text-slate-600">{Math.round(progress)}%</span>
                      </div>
                      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white">
                        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${progress}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-slate-500">{money(saved)} saved <span className="px-1 text-slate-300">/</span> {money(target)} target</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>

          <p className="text-xs text-slate-400">Amounts are shown without a currency symbol. Charts reflect bills and goals recorded in MyCloud.</p>
        </>
      )}
    </section>
  );
}
