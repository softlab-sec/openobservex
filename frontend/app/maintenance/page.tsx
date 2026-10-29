"use client";
import { useCallback, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import { Card } from "@/components/ui";
import { apiGet, apiSend, type MaintenanceWindow } from "@/lib/api";
import { useRole, canManage, canOperate } from "@/lib/role";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function MaintenancePage() {
  const role = useRole();
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
    <Shell>
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-text-primary">Maintenance Windows</h1>
        <p className="text-sm text-text-muted">
          Suppress alert firing during planned work. While a window is active, matching rules are evaluated but do not create incidents.
        </p>
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">{err}</p>
      )}

      {activeCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-status-warning/25 bg-status-warning/[0.06] px-4 py-2.5 text-sm">
          <span className="h-2 w-2 rounded-full bg-status-warning" />
          <span className="text-status-warning">
            {activeCount} active window{activeCount > 1 ? "s" : ""}: alert firing is currently suppressed for the affected scope.
          </span>
        </div>
      )}

      <Card title="Schedule a Window">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-text-secondary">Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. checkout-service deploy"
              className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-text-primary placeholder:text-text-muted focus:border-status-info/50 focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-secondary">Service (blank = all services)</span>
            <input
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="leave blank for org-wide"
              className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-text-primary placeholder:text-text-muted focus:border-status-info/50 focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-secondary">Starts</span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-text-primary focus:border-status-info/50 focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-secondary">Ends</span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-text-primary focus:border-status-info/50 focus:outline-none"
            />
          </label>
        </div>
        <div className="mt-3">
{canOperate(role) && (
          <button
            onClick={create}
            disabled={busy}
            className="rounded-lg bg-status-info/90 px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-status-info disabled:opacity-50"
          >
            {busy ? "Scheduling..." : "Schedule Window"}
          </button>
          )}
        </div>
      </Card>

      <div className="mt-6">
        <Card title="Scheduled Windows">
          {windows.length === 0 ? (
            <p className="text-sm text-text-muted">No maintenance windows scheduled.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-elevated text-left text-text-muted">
                    <th className="px-4 py-2 font-medium">Reason</th>
                    <th className="px-4 py-2 font-medium">Scope</th>
                    <th className="px-4 py-2 font-medium">Window</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {windows.map((w) => (
                    <tr key={w.id} className="border-t border-border">
                      <td className="px-4 py-2.5 text-text-secondary">{w.reason}</td>
                      <td className="px-4 py-2.5 text-text-secondary">
                        {w.service ? w.service : <span className="text-text-muted">All services</span>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-text-secondary">{fmt(w.starts_at)} to {fmt(w.ends_at)}</td>
                      <td className="px-4 py-2.5">
                        {w.active ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-status-warning">
                            <span className="h-1.5 w-1.5 rounded-full bg-status-warning" /> active
                          </span>
                        ) : new Date(w.ends_at) < new Date() ? (
                          <span className="text-xs text-text-muted">ended</span>
                        ) : (
                          <span className="text-xs text-status-info/80">scheduled</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
{canManage(role) && (
                        <button
                          onClick={() => remove(w.id)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary transition hover:border-status-critical/40 hover:text-status-critical"
                        >
                          Delete
                        </button>
                        )}
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
