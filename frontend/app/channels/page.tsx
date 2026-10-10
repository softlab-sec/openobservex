"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { apiGet, apiSend, type NotificationChannel } from "@/lib/api";
import { useRole, canManage } from "@/lib/role";

type Kind = "email" | "slack" | "discord" | "webhook";

const KIND_LABELS: Record<Kind, string> = {
  email: "Email (SMTP)",
  slack: "Slack",
  discord: "Discord",
  webhook: "Webhook",
};

function emptyConfig(kind: Kind): Record<string, string | boolean> {
  if (kind === "email")
    return { smtp_host: "", smtp_port: "587", username: "", password: "", from_addr: "", to_addrs: "", use_tls: true };
  if (kind === "slack" || kind === "discord") return { webhook_url: "" };
  return { url: "" };
}

export default function ChannelsPage() {
  const role = useRole();
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("email");
  const [config, setConfig] = useState<Record<string, string | boolean>>(emptyConfig("email"));

  const load = useCallback(() => {
    apiGet<NotificationChannel[]>("/api/v1/channels")
      .then(setChannels)
      .catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditId(null); setName(""); setKind("email"); setConfig(emptyConfig("email")); setShowForm(true);
  }
  function openEdit(ch: NotificationChannel) {
    setEditId(ch.id); setName(ch.name); setKind(ch.kind);
    setConfig({ ...emptyConfig(ch.kind), ...(ch.config as Record<string, string | boolean>) });
    setShowForm(true);
  }
  function changeKind(k: Kind) { setKind(k); setConfig(emptyConfig(k)); }

  function save() {
    setErr(null);
    const body = { name, kind, config, enabled: true };
    const req = editId
      ? apiSend<NotificationChannel>(`/api/v1/channels/${editId}`, "PATCH", body)
      : apiSend<NotificationChannel>("/api/v1/channels", "POST", body);
    req.then(() => { setShowForm(false); load(); }).catch((e: Error) => setErr(e.message));
  }

  function remove(id: string) {
    apiSend<void>(`/api/v1/channels/${id}`, "DELETE").then(load).catch((e: Error) => setErr(e.message));
  }

  function test(id: string) {
    setTestResult((r) => ({ ...r, [id]: "testing..." }));
    apiSend<{ ok: boolean; detail: string }>(`/api/v1/channels/${id}/test`, "POST")
      .then((res) => setTestResult((r) => ({ ...r, [id]: res.ok ? "✓ delivered" : `✕ ${res.detail}` })))
      .catch((e: Error) => setTestResult((r) => ({ ...r, [id]: `✕ ${e.message}` })));
  }

  const set = (k: string, v: string | boolean) => setConfig((c) => ({ ...c, [k]: v }));
  const inputCls = "w-full rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm outline-none focus:border-border";

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-text-muted">Where alerts are delivered. Configure once, then attach to alert rules.</p>
        </div>
        {canManage(role) && <button onClick={openNew} className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25">
          Add notification
        </button>}
      </div>

      {err && <p className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">{err}</p>}

      {showForm && (
        <div className="mb-6 rounded-xl border border-border bg-surface-elevated p-4">
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-text-muted">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ops Slack" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">Type</label>
              <select value={kind} onChange={(e) => changeKind(e.target.value as Kind)} className={inputCls} disabled={!!editId}>
                {(Object.keys(KIND_LABELS) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
              </select>
            </div>
          </div>

          {kind === "email" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="mb-1 block text-xs text-text-muted">SMTP host</label>
                <input value={String(config.smtp_host ?? "")} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.gmail.com" className={inputCls} /></div>
              <div><label className="mb-1 block text-xs text-text-muted">Port</label>
                <input value={String(config.smtp_port ?? "")} onChange={(e) => set("smtp_port", e.target.value)} placeholder="587" className={inputCls} /></div>
              <div><label className="mb-1 block text-xs text-text-muted">Username</label>
                <input value={String(config.username ?? "")} onChange={(e) => set("username", e.target.value)} className={inputCls} /></div>
              <div><label className="mb-1 block text-xs text-text-muted">Password</label>
                <input type="password" value={String(config.password ?? "")} onChange={(e) => set("password", e.target.value)} placeholder={editId ? "leave blank to keep" : ""} className={inputCls} /></div>
              <div><label className="mb-1 block text-xs text-text-muted">From address</label>
                <input value={String(config.from_addr ?? "")} onChange={(e) => set("from_addr", e.target.value)} placeholder="alerts@yourco.com" className={inputCls} /></div>
              <div><label className="mb-1 block text-xs text-text-muted">To (comma-separated)</label>
                <input value={String(config.to_addrs ?? "")} onChange={(e) => set("to_addrs", e.target.value)} placeholder="oncall@yourco.com" className={inputCls} /></div>
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={Boolean(config.use_tls)} onChange={(e) => set("use_tls", e.target.checked)} /> Use TLS
              </label>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs text-text-muted">{kind === "webhook" ? "Webhook URL" : `${KIND_LABELS[kind]} webhook URL`}</label>
              <input
                value={String((kind === "webhook" ? config.url : config.webhook_url) ?? "")}
                onChange={(e) => set(kind === "webhook" ? "url" : "webhook_url", e.target.value)}
                placeholder="https://..." className={inputCls}
              />
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button onClick={save} className="rounded-lg border border-status-healthy/40 bg-status-healthy/15 px-3 py-1.5 text-sm text-status-healthy hover:bg-status-healthy/25">
              {editId ? "Save changes" : "Create channel"}
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:text-text-primary">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {channels.map((ch) => (
          <div key={ch.id} className="flex items-center justify-between rounded-lg border border-border bg-surface-elevated px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{ch.name}</span>
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">{KIND_LABELS[ch.kind]}</span>
                {!ch.enabled && <span className="text-xs text-text-muted">disabled</span>}
              </div>
              {testResult[ch.id] && (
                <div className={`mt-1 text-xs ${testResult[ch.id].startsWith("✓") ? "text-status-healthy" : testResult[ch.id] === "testing..." ? "text-text-muted" : "text-status-critical"}`}>
                  {testResult[ch.id]}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canManage(role) && <button onClick={() => test(ch.id)} className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:text-text-primary">Test</button>}
              {canManage(role) && <button onClick={() => openEdit(ch)} className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:text-text-primary">Edit</button>}
              {canManage(role) && <button onClick={() => remove(ch.id)} className="rounded-md border border-status-critical/30 px-2 py-1 text-xs text-status-critical hover:bg-status-critical/15">Delete</button>}
            </div>
          </div>
        ))}
        {channels.length === 0 && <p className="text-sm text-text-muted">No notifications yet. Add one to start receiving alerts.</p>}
      </div>
    </Shell>
  );
}
