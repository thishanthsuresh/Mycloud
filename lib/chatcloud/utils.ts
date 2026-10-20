// Small pure helpers shared by the server code and the screens. No network, no database.

// ---------- file names ----------

/** "report.final.PDF" -> { stem: "report.final", ext: "pdf" } */
export function splitName(filename: string): { stem: string; ext: string } {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return { stem: base, ext: "" };
  const ext = base.slice(i + 1).toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return { stem: base, ext: "" };
  return { stem: base.slice(0, i), ext };
}

/** Make a string safe to use as a file name (no slashes, no control characters, max 80 chars). */
export function sanitizeStem(input: string, fallback = "File"): string {
  const noControl = Array.from(input)
    .filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127)
    .join("");
  const cleaned = noControl
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+/, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export const extFromMime = (mime: string): string => MIME_EXT[mime] ?? "";

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Used when the AI is unavailable: a rough category from the type and name. */
export function guessCategory(mime: string, name: string): string {
  const n = name.toLowerCase();
  if (/passport|licen[sc]e|\bnic\b|identity|\bid\b/.test(n)) return "Identity";
  if (/insurance|policy/.test(n)) return "Insurance";
  if (/invoice|receipt|bill/.test(n)) return "Receipts";
  if (/bank|statement|tax|loan/.test(n)) return "Finance";
  if (/medical|prescription|report|lab/.test(n)) return "Medical";
  if (/certificate|transcript|degree|result/.test(n)) return "Education";
  if (/contract|offer|payslip|resume|\bcv\b/.test(n)) return "Work";
  if (mime.startsWith("image/")) return "Photos";
  return "Other";
}

/** Pull the first {...} block out of a model reply and parse it. Returns null if it is not valid JSON. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------- dates (all "YYYY-MM-DD" strings, calculated in UTC so there are no timezone surprises) ----------

const toUTC = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export const isValidISODate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Today's date in UTC. */
export const todayISO = (): string => new Date().toISOString().slice(0, 10);

/** Today's date on the user's own device (used by the screens). */
export function localTodayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days from `from` to `iso`. Negative means the date has passed. */
export const daysUntil = (iso: string, from: string): number => Math.round((toUTC(iso) - toUTC(from)) / 86_400_000);

export const addDaysISO = (iso: string, days: number): string =>
  new Date(toUTC(iso) + days * 86_400_000).toISOString().slice(0, 10);

/** Add months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

/** Human text for a countdown: "due today", "in 5 days", "3 days overdue". */
export function countdownText(daysLeft: number): string {
  if (daysLeft === 0) return "due today";
  if (daysLeft === 1) return "due tomorrow";
  if (daysLeft > 1) return `in ${daysLeft} days`;
  if (daysLeft === -1) return "1 day overdue";
  return `${Math.abs(daysLeft)} days overdue`;
}
