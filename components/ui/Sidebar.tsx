"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MODULES, STATUS_STYLES } from "@/lib/modules";
import { createClient } from "@/lib/supabase/client";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [supabase] = useState(createClient);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
      setAuthLoaded(true);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const handleSignOut = async () => {
    if (signingOut) return;

    setSigningOut(true);
    setAuthError(null);
    try {
      const { error } = await supabase.auth.signOut();

      if (error) throw error;

      router.replace("/login");
      router.refresh();
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign out");
    } finally {
      setSigningOut(false);
    }
  };

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
      active ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
    }`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-40 rounded-lg bg-slate-900 px-3 py-2 text-white md:hidden"
        aria-label="Open menu"
      >
        ☰
      </button>
      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-slate-900 transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-5">
          <div className="text-xl font-bold text-white">☁️ MyCloud</div>
          <div className="text-xs text-slate-400">The Odyssey Crew</div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          <Link href="/dashboard" onClick={() => setOpen(false)} className={linkClass(isActive("/dashboard"))}>
            <span>🏠</span>
            <span className="font-medium">Dashboard</span>
          </Link>

          <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Modules</div>

          {MODULES.map((m) => {
            const href = `/${m.slug}`;
            return (
              <Link key={m.slug} href={href} onClick={() => setOpen(false)} className={linkClass(isActive(href))}>
                <span>{m.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="block truncate text-xs opacity-70">{m.owner}</span>
                </span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_STYLES[m.status].dot}`} title={STATUS_STYLES[m.status].label} />
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 px-4 py-4 text-xs text-slate-400">
          {authLoaded && userEmail ? (
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-lg">
                👤
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Signed in as</div>
                <div className="truncate text-slate-200">{userEmail}</div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="mt-1 text-slate-300 hover:text-white disabled:opacity-60"
                >
                  {signingOut ? "Signing out..." : "Sign out"}
                </button>
              </div>
            </div>
          ) : authLoaded ? (
            <Link href="/login" className="flex items-center gap-3 rounded-lg py-1 text-slate-200 hover:text-white">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-lg">
                👤
              </span>
              <span>Log in or sign up</span>
            </Link>
          ) : (
            <div className="py-2">Loading account...</div>
          )}
          {authError && <p role="alert" className="mt-2 text-red-300">{authError}</p>}
        </div>
      </aside>
    </>
  );
}
