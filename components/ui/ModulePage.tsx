"use client";
import { useState, type ReactNode } from "react";
import { getModule, STATUS_STYLES } from "@/lib/modules";

type Props = {
  slug: string;
  // Attach your screens here: { Files: <FileList />, Renewals: <RenewalList /> }
  // Keys must match the `tabs` listed for your module in lib/modules.ts
  sections?: Record<string, ReactNode>;
};

export default function ModulePage({ slug, sections = {} }: Props) {
  const mod = getModule(slug);
  const status = STATUS_STYLES[mod.status];
  const [active, setActive] = useState(mod.tabs[0]);
  const content = sections[active];
  const hasPlannedFeatures = mod.features.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-2xl">{mod.icon}</div>
          <div>
            <h1 className="text-2xl font-bold">{mod.name}</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-600">{mod.description}</p>
            <p className="mt-2 text-xs text-slate-500">Module owner: <span className="font-medium text-slate-700">{mod.owner}</span></p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${status.chip}`}>{status.label}</span>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={hasPlannedFeatures ? "lg:col-span-2" : "lg:col-span-3"}>
          <div className="flex gap-1 border-b border-slate-200">
            {mod.tabs.map((t) => (
              <button
                key={t}
                onClick={() => setActive(t)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                  active === t ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-4 min-h-[320px] rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            {content ?? (
              <div className="flex h-full min-h-[270px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-center">
                <div className="text-3xl">{mod.icon}</div>
                <p className="mt-2 font-semibold text-slate-700">{active}</p>
                <p className="mt-1 text-sm text-slate-500">Attach this screen here.</p>
                <code className="mt-3 rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
                  components/features/{mod.slug}/
                </code>
              </div>
            )}
          </div>
        </section>

        {hasPlannedFeatures && (
          <aside className="h-fit rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold text-slate-800">Planned features</h2>
            <ul className="mt-3 space-y-2">
              {mod.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                  <span className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded border border-slate-300" />
                  {f}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
