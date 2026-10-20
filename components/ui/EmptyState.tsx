import type { ReactNode } from "react";

type Props = { icon?: string; title: string; description?: string; action?: ReactNode };

export default function EmptyState({ icon = "📭", title, description, action }: Props) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-6 py-10 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="mt-2 font-semibold text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
