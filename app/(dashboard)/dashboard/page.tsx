import Link from "next/link";
import { MODULES } from "@/lib/modules";

export default function DashboardHome() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Welcome to MyCloud</h1>
        <p className="text-sm text-slate-600">Six modules, one platform. Open a module from the sidebar or the cards below.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((m) => (
          <Link key={m.slug} href={`/${m.slug}`} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-indigo-300">
            <div className="flex items-center justify-between">
              <span className="text-2xl">{m.icon}</span>
            </div>
            <h2 className="mt-3 font-semibold">{m.name}</h2>
            <p className="mt-1 text-sm text-slate-600">{m.description}</p>
            <p className="mt-3 text-xs text-slate-500">Owner: {m.owner}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
