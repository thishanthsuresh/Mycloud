"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ProfessionalOrganization } from "./ProfessionalSpace";

type Member = {
  id: string;
  user_id: string | null;
  email: string;
  display_name: string;
  role: "manager" | "employee";
  status: "invited" | "active";
  created_at: string;
};

type ApiError = { error?: string };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
  return result;
}

export default function MembersPanel({ organization, onChanged }: { organization: ProfessionalOrganization; onChanged: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isManager = organization.membership.role === "manager";
  const endpoint = `/api/professional/${encodeURIComponent(organization.id)}/members`;

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await requestJson<{ members: Member[] }>(endpoint);
      setMembers(result.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load organization members.");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMembers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMembers]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<{ member: Member }>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setMembers((current) => [...current, result.member]);
      setEmail("");
      setNotice(`${result.member.email} has been invited. They must accept in Professional Space.`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not invite this staff member.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(member: Member) {
    if (removingId) return;
    if (!window.confirm(`Remove ${member.display_name} from ${organization.name}? Their access to assigned work and shared folders will end.`)) return;
    setRemovingId(member.id);
    setError(null);
    setNotice(null);
    try {
      await requestJson(`${endpoint}/${encodeURIComponent(member.id)}`, { method: "DELETE" });
      setMembers((current) => current.filter((item) => item.id !== member.id));
      setNotice(`${member.display_name} was removed.`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this staff member.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg font-bold text-slate-900">People in {organization.name}</h2>
        <p className="mt-1 text-sm text-slate-500">{isManager ? "Invite staff and manage organization access." : "Your organization role and access."}</p>
      </header>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      {isManager && (
        <form onSubmit={(event) => void invite(event)} className="flex flex-col gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 sm:flex-row">
          <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600">
            Invite a MyCloud account by email
            <input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="colleague@example.com" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
          </label>
          <button type="submit" disabled={saving || !email.trim()} className="self-end rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? "Inviting…" : "Invite staff"}</button>
        </form>
      )}

      {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading members…</p> : members.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-7 text-center text-sm text-slate-500">No members to show.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">{member.display_name.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{member.display_name}</p>
                  <p className="truncate text-xs text-slate-500">{member.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-700">{member.role}</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${member.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{member.status === "active" ? "Active" : "Invitation pending"}</span>
                {isManager && member.role !== "manager" && (
                  <button type="button" onClick={() => void removeMember(member)} disabled={removingId === member.id} className="rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                    {removingId === member.id ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
