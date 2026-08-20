"use client";
import { useCallback, useEffect, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import { useRole, canManage } from "@/lib/role";
import { apiGet, type AuditPage, type AuditRow } from "@/lib/api";

function Diff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  if (!before && !after) return <span className="text-white/25">—</span>;
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  return (
    <div className="space-y-0.5">
      {keys.map((k) => (
        <div key={k} className="font-mono text-[11px]">
          <span className="text-white/40">{k}: </span>
          {before && k in before && (
            <span className="text-rose-300/80 line-through">{String(before[k])}</span>
          )}
          {before && after && k in before && k in after && <span className="text-white/30"> → </span>}
          {after && k in after && <span className="text-emerald-300/80">{String(after[k])}</span>}
        </div>
      ))}
    </div>
  );
}

export default function AuditPage() {
  const role = useRole();
  const [data, setData] = useState<AuditPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [actions, setActions] = useState<string[]>([]);

  // filters
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (action) p.set("action", action);
    if (resourceType) p.set("resource_type", resourceType);
    if (actor) p.set("actor_email", actor);
    if (q) p.set("q", q);
    if (start) p.set("start", new Date(start).toISOString());
    if (end) p.set("end", new Date(end).toISOString());
    p.set("limit", "200");
    apiGet<AuditPage>(`/api/v1/audit?${p.toString()}`)
      .then((d) => { setData(d); setErr(null); })
      .catch((e: Error) => setErr(e.message));
  }, [action, resourceType, actor, q, start, end]);

  useEffect(() => {
    apiGet<string[]>("/api/v1/audit/actions").then(setActions).catch(() => {});
  }, []);
  usePoll(load, [action, resourceType, actor, q, start, end], 15000);

  if (!canManage(role)) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-12 text-center text-sm text-white/40">
        The audit log is available to administrators only.
      </div>
    );
  }

  const resourceTypes = ["alert_rule", "api_key", "application", "channel", "maintenance_window", "incident", "user"];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white/90">Audit Log</h1>
        <p className="text-sm text-white/40">An append-only record of security and configuration changes. Who did what, when.</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-6">
        <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="user email…"
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white/80 placeholder:text-white/30 focus:outline-none" />
        <select value={action} onChange={(e) => setAction(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white/80 focus:outline-none">
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={resourceType} onChange={(e) => setResourceType(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white/80 focus:outline-none">
          <option value="">All resources</option>
          {resourceTypes.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white/80 focus:outline-none" />
        <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white/80 focus:outline-none" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…"
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white/80 placeholder:text-white/30 focus:outline-none" />
      </div>

      {err && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</p>}

      <div className="mb-2 text-xs text-white/40">{data ? `${data.total} events` : "loading…"}</div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 bg-white/[0.02] text-xs uppercase tracking-wide text-white/40">
            <tr>
              <th className="px-3 py-2 font-medium">Time (UTC)</th>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Resource</th>
              <th className="px-3 py-2 font-medium">Change</th>
              <th className="px-3 py-2 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r: AuditRow) => (
              <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-white/60">{r.created_at.replace("T", " ").slice(0, 19)}</td>
                <td className="px-3 py-2 text-white/80">{r.actor_email}</td>
                <td className="px-3 py-2 text-white/50">{r.actor_role}</td>
                <td className="whitespace-nowrap px-3 py-2"><span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[11px] text-white/70">{r.action}</span></td>
                <td className="px-3 py-2 text-white/70">{r.resource_name ?? r.resource_id ?? <span className="text-white/25">—</span>}</td>
                <td className="px-3 py-2"><Diff before={r.before} after={r.after} /></td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-white/40">{r.ip_address ?? "—"}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-12 text-center text-sm text-white/40">No audit events match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
