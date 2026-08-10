"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiGet, clearToken, getToken, type Me } from "@/lib/api";

type NavItem = { href: string; label: string; icon: string };
type NavGroup = { title: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Monitor",
    items: [
      { href: "/dashboard", label: "Overview", icon: "M3 12h4l3 8 4-16 3 8h4" },
      { href: "/traces", label: "Traces", icon: "M4 6h16M4 12h10M4 18h7" },
      { href: "/map", label: "Service Map", icon: "M5 6a2 2 0 100-4 2 2 0 000 4zM19 22a2 2 0 100-4 2 2 0 000 4zM5 6c0 8 14 4 14 12" },
      { href: "/logs", label: "Logs", icon: "M4 4h16v4H4zM4 12h16M4 16h16M4 20h10" },
      { href: "/infra", label: "Infrastructure", icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
    ],
  },
  {
    title: "Respond",
    items: [
      { href: "/alerts", label: "Alerts", icon: "M12 3a6 6 0 016 6c0 5 2 7 2 7H4s2-2 2-7a6 6 0 016-6zM10 21h4" },
      { href: "/incidents", label: "Incidents", icon: "M12 9v4m0 4h.01M10.3 3.9L2 18a1 1 0 00.9 1.5h18.2A1 1 0 0022 18L13.7 3.9a1 1 0 00-1.7 0z" },
      { href: "/anomalies", label: "Anomalies", icon: "M3 12h4l2-7 4 14 2-7h6" },
    ],
  },
  {
    title: "Manage",
    items: [
      { href: "/applications", label: "Applications", icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
      { href: "/channels", label: "Notifications", icon: "M4 4h16v12H5.2L4 17.2V4z" },
      { href: "/system", label: "System Health", icon: "M4 12h4l2-5 3 10 2-5h5" },
    ],
  },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiGet<Me>("/api/v1/auth/me")
      .then((u) => {
        setMe(u);
        setReady(true);
      })
      .catch(() => {
        clearToken();
        router.replace("/login");
      });
  }, [router]);

  function logout() {
    clearToken();
    router.replace("/login");
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-white/40">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={`${
          collapsed ? "w-16" : "w-56"
        } shrink-0 border-r border-white/10 p-3 transition-all duration-200`}
      >
        <div className="mb-6 flex items-center justify-between px-1">
          {!collapsed && (
            <div className="overflow-hidden">
              <div className="whitespace-nowrap text-lg font-semibold tracking-tight">
                OpenObserveX
              </div>
              <div className="text-xs text-white/40">observability platform</div>
            </div>
          )}
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-label="Toggle menu"
            className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className="space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-white/30">
                  {group.title}
                </div>
              )}
              <div className="space-y-1">
                {group.items.map((n) => {
                  const active = pathname === n.href;
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      title={collapsed ? n.label : undefined}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                        active
                          ? "bg-white/10 text-white"
                          : "text-white/60 hover:bg-white/5 hover:text-white"
                      } ${collapsed ? "justify-center px-0" : ""}`}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d={n.icon} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {!collapsed && <span>{n.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className={`mt-8 border-t border-white/10 pt-4 ${collapsed ? "px-0" : "px-2"}`}>
          {!collapsed && (
            <>
              <div className="truncate text-xs text-white/60">{me?.email}</div>
              <div className="text-xs text-white/30">{me?.role}</div>
            </>
          )}
          <button
            onClick={logout}
            title={collapsed ? "Sign out" : undefined}
            className={`mt-3 w-full rounded-lg border border-white/10 py-1.5 text-xs text-white/60 hover:bg-white/5 hover:text-white ${
              collapsed ? "px-0" : "px-2"
            }`}
          >
            {collapsed ? "\u23fb" : "Sign out"}
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto p-6">{children}</main>
    </div>
  );
}

/** Re-run a loader on an interval.
 *
 * Two guards that matter under load:
 *  - never start a new poll while the previous one is still running
 *  - pause entirely while the browser tab is hidden
 * Without these, slow queries stack up and exhaust the API thread pool.
 */
export function usePoll(
  fn: () => Promise<unknown> | void,
  deps: unknown[],
  intervalMs = 10000
) {
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled || inFlight.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      inFlight.current = true;
      try {
        await fn();
      } finally {
        inFlight.current = false;
      }
    };

    run();
    const id = setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
