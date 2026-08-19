"use client";
import { useCallback, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import { Card } from "@/components/ui";
import { apiGet, apiSend, type MaintenanceWindow } from "@/lib/api";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function MaintenancePage() {
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const [reason, setReason] = useState("");
  const [service, setService] = useState("");
  const [startsAt, setStartsAt] = useState(toLocalInput(now));
  const [endsAt, setEndsAt] = useState(toLocalInput(inOneHour));

  const load = useCallback(() => {
    apiGet<MaintenanceWindow[]>("/api/v1/maintenance")
      .then((d) => { setWindows(d); setErr(null); })
      .catch((e: Error) => setErr(e.message));
  }, []);
  usePoll(load, [], 15000);

  async function create() {
    if (!reason.trim()) { setErr("Reason is required"); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiSend<MaintenanceWindow>("/api/v1/maintenance", "POST", {
        reason: reason.trim(),
        service: service.trim() || null,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
      });
      setReason("");
      setService("");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await apiSend<void>(`/api/v1/maintenance/${id}`, "DELETE");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const activeCount = windows.filter((w) => w.active).length;

  return (
    <Shell title="Maintenance Windows">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-white">Maintenance Windows</h1>
        <p className="text-sm text-white/50">
          Suppress alert firing during planned work. While a window is active, matching rules are evaluated but do not create incidents.
        </p>
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</p>
      )}

      {activeCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-4 py-2.5 text-sm">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="text-amber-200">
            {activeCount} active window{activeCount > 1 ? "s" : ""}: alert firing is currently suppressed for the affected scope.
          </span>
        </div>
      )}

      <Card title="Schedule a Window">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-white/60">Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. checkout-service deploy"
              className="w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2 text-white placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-white/60">Service (blank = all services)</span>
            <input
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="leave blank for org-wide"
              className="w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2 text-white placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-white/60">Starts</span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2 text-white focus:border-sky-400/50 focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-white/60">Ends</span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2 text-white focus:border-sky-400/50 focus:outline-none"
            />
          </label>
        </div>
        <div className="mt-3">
          <button
            onClick={create}
            disabled={busy}
            className="rounded-lg bg-sky-500/90 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? "Scheduling..." : "Schedule Window"}
          </button>
        </div>
      </Card>

      <div className="mt-6">
        <Card title="Scheduled Windows">
          {windows.length === 0 ? (
            <p className="text-sm text-white/40">No maintenance windows scheduled.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white/[0.04] text-left text-white/50">
                    <th className="px-4 py-2 font-medium">Reason</th>
                    <th className="px-4 py-2 font-medium">Scope</th>
                    <th className="px-4 py-2 font-medium">Window</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {windows.map((w) => (
                    <tr key={w.id} className="border-t border-white/5">
                      <td className="px-4 py-2.5 text-white/80">{w.reason}</td>
                      <td className="px-4 py-2.5 text-white/70">
                        {w.service ? w.service : <span className="text-white/40">All services</span>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-white/70">{fmt(w.starts_at)} to {fmt(w.ends_at)}</td>
                      <td className="px-4 py-2.5">
                        {w.active ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-amber-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> active
                          </span>
                        ) : new Date(w.ends_at) < new Date() ? (
                          <span className="text-xs text-white/40">ended</span>
                        ) : (
                          <span className="text-xs text-sky-300/80">scheduled</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => remove(w.id)}
                          className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/70 transition hover:border-red-400/40 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
