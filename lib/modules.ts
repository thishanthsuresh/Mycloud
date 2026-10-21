// ONE place that defines every module in the sidebar.
// Each member: change `status` here when your module moves forward.
export type ModuleStatus = "not-started" | "in-progress" | "live";

export type ModuleDef = {
  slug: string; // route: /<slug>
  name: string;
  owner: string;
  icon: string;
  description: string;
  status: ModuleStatus;
  tabs: string[]; // one tab per screen you plan to build
  features: string[];
};

export const STATUS_STYLES: Record<ModuleStatus, { label: string; chip: string; dot: string }> = {
  "not-started": { label: "Not attached", chip: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  "in-progress": { label: "In progress", chip: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
  live: { label: "Live", chip: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-400" },
};

export const MODULES: ModuleDef[] = [
  {
    slug: "chatcloud", name: "ChatCloud", owner: "S. Thishanth", icon: "📁", status: "not-started",
    description: "Files are stored, AI-named, categorized and tracked for renewal.",
    tabs: ["Files", "Renewals"],
    features: [],
  },
  {
    slug: "financial", name: "Financial Manager", owner: "R. Kirushanth", icon: "💰", status: "in-progress",
    description: "Track bills and expenses, scan receipts, and plan savings goals.",
    tabs: ["Overview", "Bills", "Goals"],
    features: [],
  },
  {
    slug: "security", name: "Security & Vault", owner: "S. Kavina", icon: "🛡️", status: "live",
    description: "Review device sign-ins, encrypt personal files in a PIN-protected vault, and send encrypted files through Messenger.",
    tabs: ["Devices", "Personal Vault", "Encrypted Share"],
    features: [],
  },
  {
    slug: "chatbot", name: "AI Chatbot", owner: "Muraliharan Ashvijan", icon: "🤖", status: "in-progress",
    description: "Ask questions about ChatCloud, your file library, and renewal records.",
    tabs: ["Chat", "History"],
    features: ["Ask what documents you have", "Checklist comparison (what is missing)", "Conversation history", "Metadata-only AI context", "Graceful error handling"],
  },
  {
    slug: "messenger", name: "Messenger", owner: "A. Venmukilan", icon: "💬", status: "in-progress",
    description: "Send private messages and media to other users, save them in your personal chat, and manage bills.",
    tabs: ["Conversations"],
    features: [],
  },
  {
    slug: "professional", name: "Professional Space", owner: "J. Aarwin", icon: "🏢", status: "not-started",
    description: "Organization workspace where managers request documents from employees.",
    tabs: ["Requests", "Shared Folders", "Members"],
    features: ["Create organization and invite staff", "Document requests with due dates", "Request status workflow", "Shared folders with selected access", "Admin vs employee views"],
  },
];

export const getModule = (slug: string): ModuleDef => {
  const m = MODULES.find((x) => x.slug === slug);
  if (!m) throw new Error(`Unknown module: ${slug}`);
  return m;
};
