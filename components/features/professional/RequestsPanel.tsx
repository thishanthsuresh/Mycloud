"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ProfessionalOrganization } from "./ProfessionalSpace";

type Member = { id: string; display_name: string; email: string; role: "manager" | "employee"; status: "invited" | "active" };
type DocumentRequest = {
  id: string;
  title: string;
  description: string;
  due_date: string | null;
  status: "open" | "submitted" | "approved" | "changes_requested";
  assigned_member_id: string;
  attachment_name: string | null;
  attachment_size: number | null;
  attachmentUrl: string | null;
  created_at: string;
  assignee: { display_name: string; email: string } | null;
};
type ApiError = { error?: string };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
  return result;
}

function statusLabel(status: DocumentRequest["status"]) {
  return {
    open: "Needs submission",
    submitted: "Submitted for review",
    approved: "Approved",
    changes_requested: "Changes requested",
  }[status];
}

function statusStyle(status: DocumentRequest["status"]) {
  return {
    open: "bg-slate-100 text-slate-700",
    submitted: "bg-indigo-50 text-indigo-700",
    approved: "bg-emerald-50 text-emerald-700",
    changes_requested: "bg-amber-50 text-amber-800",
  }[status];
}

export default function RequestsPanel({ organization }: { organization: ProfessionalOrganization }) {
  const [requests, setRequests] = useState<DocumentRequest[]>([]);
  const [employees, setEmployees] = useState<Member[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedMemberId, setAssignedMemberId] = useState("");
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isManager = organization.membership.role === "manager";
  const baseUrl = `/api/professional/${encodeURIComponent(organization.id)}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const requestsResult = await requestJson<{ requests: DocumentRequest[] }>(`${baseUrl}/requests`);
      setRequests(requestsResult.requests);
      if (isManager) {
        const memberResult = await requestJson<{ members: Member[] }>(`${baseUrl}/members`);
        const activeEmployees = memberResult.members.filter((member) => member.role === "employee" && member.status === "active");
        setEmployees(activeEmployees);
        setAssignedMemberId((current) => activeEmployees.some((member) => member.id === current) ? current : activeEmployees[0]?.id ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load document requests.");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, isManager]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson(`${baseUrl}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, dueDate, assignedMemberId }),
      });
      setTitle("");
      setDescription("");
      setDueDate("");
      await load();
      setNotice("Document request sent to the assigned employee.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create document request.");
    } finally {
      setCreating(false);
    }
  }

  async function submitDocument(documentRequest: DocumentRequest) {
    const file = files[documentRequest.id];
    if (!file || busyId) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("Documents must be 10 MB or smaller.");
      return;
    }
    setBusyId(documentRequest.id);
    setError(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("action", "submit");
      body.set("file", file);
      await requestJson(`${baseUrl}/requests/${encodeURIComponent(documentRequest.id)}`, { method: "PATCH", body });
      setFiles((current) => {
        const next = { ...current };
        delete next[documentRequest.id];
        return next;
      });
      await load();
      setNotice("Document submitted to your manager for review.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit this document.");
    } finally {
      setBusyId(null);
    }
  }

  async function reviewRequest(documentRequest: DocumentRequest, action: "approve" | "changes_requested") {
    if (busyId) return;
    setBusyId(documentRequest.id);
    setError(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("action", action);
      await requestJson(`${baseUrl}/requests/${encodeURIComponent(documentRequest.id)}`, { method: "PATCH", body });
      await load();
      setNotice(action === "approve" ? "Document request approved." : "Changes requested from the employee.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not review this submission.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg font-bold text-slate-900">{isManager ? "Document requests" : "Your document requests"}</h2>
        <p className="mt-1 text-sm text-slate-500">{isManager ? "Assign documents to staff, set due dates, and review their submissions." : "Upload the requested documents and follow their review status."}</p>
      </header>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      {isManager && (
        <form onSubmit={(event) => void createRequest(event)} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">Request title
            <input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} className={`${inputClass} mt-1 bg-white font-normal`} placeholder="Signed employment agreement" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Assign to
            <select required value={assignedMemberId} onChange={(event) => setAssignedMemberId(event.target.value)} className={`${inputClass} mt-1 bg-white font-normal`} disabled={!employees.length}>
              {employees.length ? employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.display_name} · {employee.email}</option>) : <option value="">Invite and activate an employee first</option>}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Due date <span className="font-normal">(optional)</span>
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={`${inputClass} mt-1 bg-white font-normal`} />
          </label>
          <label className="text-xs font-semibold text-slate-600">Instructions <span className="font-normal">(optional)</span>
            <input maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} className={`${inputClass} mt-1 bg-white font-normal`} placeholder="Add context for this request" />
          </label>
          <button type="submit" disabled={creating || !employees.length || !title.trim()} className="w-fit rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 md:col-span-2">{creating ? "Sending…" : "Create document request"}</button>
        </form>
      )}

      {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading requests…</p> : requests.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{isManager ? "No requests yet. Create one after inviting staff." : "No documents have been requested from you."}</p>
      ) : (
        <ul className="space-y-3">
          {requests.map((item) => (
            <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900">{item.title}</h3>
                  {item.description && <p className="mt-1 text-sm leading-5 text-slate-600">{item.description}</p>}
                  <p className="mt-2 text-xs text-slate-500">
                    {isManager && item.assignee ? `Assigned to ${item.assignee.display_name} · ` : ""}
                    {item.due_date ? `Due ${new Date(`${item.due_date}T00:00:00`).toLocaleDateString()}` : "No due date"}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(item.status)}`}>{statusLabel(item.status)}</span>
              </div>
              {item.attachmentUrl && (
                <a href={item.attachmentUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-indigo-700 underline">
                  📄 {item.attachment_name ?? "View submitted document"}
                  {item.attachment_size !== null && ` · ${(item.attachment_size / (1024 * 1024)).toFixed(1)} MB`}
                </a>
              )}
              {!isManager && (item.status === "open" || item.status === "changes_requested") && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="file" accept="image/*,application/pdf,text/plain,.doc,.docx,.xlsx" onChange={(event) => setFiles((current) => ({ ...current, [item.id]: event.target.files?.[0] }))} className="min-w-0 flex-1 text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-xs file:font-medium file:text-indigo-700" />
                  <button type="button" onClick={() => void submitDocument(item)} disabled={!files[item.id] || busyId === item.id} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{busyId === item.id ? "Submitting…" : "Submit document"}</button>
                </div>
              )}
              {isManager && item.status === "submitted" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void reviewRequest(item, "approve")} disabled={busyId === item.id} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busyId === item.id ? "Updating…" : "Approve"}</button>
                  <button type="button" onClick={() => void reviewRequest(item, "changes_requested")} disabled={busyId === item.id} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">Request changes</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
