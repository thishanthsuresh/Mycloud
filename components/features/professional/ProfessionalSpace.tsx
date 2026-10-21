"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import MembersPanel from "./MembersPanel";
import RequestsPanel from "./RequestsPanel";
import SharedFoldersPanel from "./SharedFoldersPanel";

export type ProfessionalMembership = {
  id: string;
  organization_id: string;
  user_id: string | null;
  email: string;
  display_name: string;
  role: "manager" | "employee";
  status: "invited" | "active";
};

export type ProfessionalOrganization = {
  id: string;
  name: string;
  created_at: string;
  membership: ProfessionalMembership;
};

type ApiError = { error?: string };
type TabName = "Requests" | "Shared Folders" | "Members";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
  return result;
}

export default function ProfessionalSpace() {
  const [organizations, setOrganizations] = useState<ProfessionalOrganization[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [showCreateOrganization, setShowCreateOrganization] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>("Requests");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOrganizations = useCallback(async () => {
    try {
      const result = await requestJson<{ organizations: ProfessionalOrganization[] }>("/api/professional/workspaces");
      setOrganizations(result.organizations);
      setSelectedOrganizationId((current) =>
        result.organizations.some((organization) => organization.id === current)
          ? current
          : result.organizations.find((organization) => organization.membership.status === "active")?.id ?? result.organizations[0]?.id ?? "",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Professional Space.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOrganizations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOrganizations]);

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<{ organization: ProfessionalOrganization }>("/api/professional/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: organizationName }),
      });
      setOrganizations((current) => [result.organization, ...current]);
      setSelectedOrganizationId(result.organization.id);
      setOrganizationName("");
      setShowCreateOrganization(false);
      setNotice("Organization created. You are its manager.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the organization.");
    } finally {
      setCreating(false);
    }
  }

  async function acceptInvitation(organization: ProfessionalOrganization) {
    if (busyInvitationId) return;
    setBusyInvitationId(organization.membership.id);
    setError(null);
    setNotice(null);
    try {
      await requestJson(
        `/api/professional/${encodeURIComponent(organization.id)}/members/${encodeURIComponent(organization.membership.id)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept" }) },
      );
      await loadOrganizations();
      setSelectedOrganizationId(organization.id);
      setNotice(`You joined ${organization.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept this invitation.");
    } finally {
      setBusyInvitationId(null);
    }
  }

  const selectedOrganization = organizations.find((organization) => organization.id === selectedOrganizationId);
  const activeOrganizations = organizations.filter((organization) => organization.membership.status === "active");
  const pendingInvitations = organizations.filter((organization) => organization.membership.status === "invited");
  const tabs: TabName[] = ["Requests", "Shared Folders", "Members"];

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-800 p-6 text-white shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-200">Professional Space</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">A better way to work together</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-200">Request documents, track submissions, and share files with only the staff who need access.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium">
              {selectedOrganization ? (selectedOrganization.membership.role === "manager" ? "Manager view" : "Employee view") : "Private workspace"}
            </span>
            {selectedOrganization && (
              <button
                type="button"
                onClick={() => {
                  setShowCreateOrganization((current) => !current);
                  setError(null);
                  setNotice(null);
                }}
                className="rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
              >
                {showCreateOrganization ? "Cancel" : "+ Create organization"}
              </button>
            )}
          </div>
        </div>
      </header>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      {selectedOrganization && showCreateOrganization && (
        <form onSubmit={(event) => void createOrganization(event)} className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm sm:flex-row">
          <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600">
            New organization name
            <input required minLength={2} maxLength={120} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Organization name" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
          </label>
          <button type="submit" disabled={creating || !organizationName.trim()} className="self-end rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{creating ? "Creating…" : "Create organization"}</button>
        </form>
      )}

      {pendingInvitations.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-950">Organization invitations</h2>
          <ul className="mt-3 space-y-2">
            {pendingInvitations.map((organization) => (
              <li key={organization.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3">
                <div>
                  <p className="font-medium text-slate-900">{organization.name}</p>
                  <p className="text-xs text-slate-500">Invited as an employee</p>
                </div>
                <button type="button" onClick={() => void acceptInvitation(organization)} disabled={busyInvitationId === organization.membership.id} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                  {busyInvitationId === organization.membership.id ? "Joining…" : "Accept invitation"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <p className="p-8 text-center text-sm text-slate-500">Loading organizations…</p>
          ) : selectedOrganization ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
                <div className="min-w-0">
                  <label htmlFor="professional-organization" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Organization</label>
                  <select id="professional-organization" value={selectedOrganizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)} className="mt-1 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                    {activeOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
                  </select>
                </div>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold capitalize text-indigo-700">{selectedOrganization.membership.role}</span>
              </div>
              <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 pt-2">
                {tabs.map((tab) => (
                  <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${activeTab === tab ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                    {tab}
                  </button>
                ))}
              </div>
              <div className="p-4 sm:p-6">
                {activeTab === "Requests" && <RequestsPanel organization={selectedOrganization} />}
                {activeTab === "Shared Folders" && <SharedFoldersPanel organization={selectedOrganization} />}
                {activeTab === "Members" && <MembersPanel organization={selectedOrganization} onChanged={() => void loadOrganizations()} />}
              </div>
            </>
          ) : (
            <div className="p-7 sm:p-10">
              <div className="mx-auto max-w-lg text-center">
                <span className="text-4xl" aria-hidden="true">🏢</span>
                <h2 className="mt-3 text-xl font-bold text-slate-900">Start your professional workspace</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">Create an organization to invite staff, request documents, and share folders with selected employees.</p>
              </div>
              <form onSubmit={(event) => void createOrganization(event)} className="mx-auto mt-6 flex max-w-lg flex-col gap-3 sm:flex-row">
                <input required minLength={2} maxLength={120} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Organization name" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                <button type="submit" disabled={creating || !organizationName.trim()} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">{creating ? "Creating…" : "Create organization"}</button>
              </form>
            </div>
          )}
        </section>

        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">How it works</h2>
          <ul className="mt-4 space-y-3 text-sm leading-5 text-slate-600">
            <li className="flex gap-2"><span className="text-indigo-600">01</span><span>Managers invite existing MyCloud accounts by email.</span></li>
            <li className="flex gap-2"><span className="text-indigo-600">02</span><span>Employees accept the invitation to see assigned document requests.</span></li>
            <li className="flex gap-2"><span className="text-indigo-600">03</span><span>Shared folders are visible only to managers and selected staff.</span></li>
          </ul>
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">Documents and folders use private storage. Only signed-in organization members with access can open shared files.</p>
        </aside>
      </div>
    </section>
  );
}
