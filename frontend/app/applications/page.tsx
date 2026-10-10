"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import {
  apiGet, apiSend, type Application, type ApiKeyRow, type ApiKeyCreated,
} from "@/lib/api";
import { useRole, canManage } from "@/lib/role";

export default function ApplicationsPage() {
  const role = useRole();
  const [apps, setApps] = useState<Application[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [justCreated, setJustCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const loadApps = useCallback(() => {
    apiGet<Application[]>("/api/v1/applications")
      .then((a) => {
        setApps(a);
        if (!selected && a.length) setSelected(a[0].id);
      })
      .catch((e: Error) => setErr(e.message));
  }, [selected]);

  const loadKeys = useCallback((appId: string) => {
    apiGet<ApiKeyRow[]>(`/api/v1/applications/${appId}/keys`)
      .then(setKeys)
      .catch((e: Error) => setErr(e.message));
  }, []);

  useEffect(() => { loadApps(); }, [loadApps]);
  useEffect(() => { if (selected) loadKeys(selected); }, [selected, loadKeys]);

  function generate() {
    if (!selected) return;
    setErr(null);
    apiSend<ApiKeyCreated>(`/api/v1/applications/${selected}/keys`, "POST", {
      name: newKeyName.trim() || "default",
    })
      .then((created) => {
        setJustCreated(created);
        setNewKeyName("");
        setCopied(false);
        loadKeys(selected);
      })
      .catch((e: Error) => setErr(e.message));
  }

  function revoke(keyId: string) {
    if (!selected) return;
    apiSend<void>(`/api/v1/applications/${selected}/keys/${keyId}`, "DELETE")
      .then(() => loadKeys(selected))
      .catch((e: Error) => setErr(e.message));
  }

  const app = apps.find((a) => a.id === selected);

  return (
    <Shell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Applications</h1>
        <p className="text-sm text-text-muted">
          Each application has ingestion keys. Point your telemetry at the gateway with a key
          and it is stamped with this application&apos;s tenant automatically.
        </p>
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">{err}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-1">
          {apps.map((a) => (
            <button
              key={a.id}
              onClick={() => { setSelected(a.id); setJustCreated(null); }}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                selected === a.id
                  ? "border-border bg-surface-hover"
                  : "border-border text-text-secondary hover:bg-surface-elevated"
              }`}
            >
              <div className="font-medium">{a.name}</div>
              <div className="text-[11px] text-text-muted">{a.namespace}</div>
            </button>
          ))}
          {apps.length === 0 && (
            <p className="text-sm text-text-muted">No applications yet.</p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface-elevated p-4">
          {app ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-medium">{app.name}</h2>
                  <p className="text-xs text-text-muted">
                    tenant <span className="font-mono text-text-secondary">{app.tenant_tag}</span>
                    {" · "}namespace <span className="font-mono text-text-secondary">{app.namespace}</span>
                  </p>
                </div>
              </div>

              {justCreated && (
                <div className="mb-4 rounded-lg border border-status-healthy/40 bg-status-healthy/10 p-3">
                  <p className="text-xs text-status-healthy">
                    Copy this key now. It is shown once and cannot be retrieved again.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 overflow-x-auto rounded bg-surface-elevated px-2 py-1.5 font-mono text-xs text-status-healthy">
                      {justCreated.full_key}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(justCreated.full_key);
                        setCopied(true);
                      }}
                      className="rounded-md border border-status-healthy/40 px-2 py-1 text-xs text-status-healthy hover:bg-status-healthy/20"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}

              <div className="mb-4 flex items-center gap-2">
                <input
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Key name (e.g. production)"
                  className="flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm outline-none focus:border-border"
                />
{canManage(role) && (
                <button
                  onClick={generate}
                  className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25"
                >
                  Generate key
                </button>
                )}
              </div>

              <div className="space-y-2">
                {keys.map((k) => (
                  <div
                    key={k.id}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                      k.revoked_at ? "border-border opacity-50" : "border-border"
                    }`}
                  >
                    <div>
                      <span className="font-mono text-text-secondary">{k.prefix}…</span>
                      <span className="ml-2 text-text-muted">{k.name}</span>
                      {k.revoked_at && <span className="ml-2 text-xs text-status-critical">revoked</span>}
                      <div className="text-[11px] text-text-muted">
                        {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleString()}` : "never used"}
                      </div>
                    </div>
                    {!k.revoked_at && canManage(role) && (
                      <button
                        onClick={() => revoke(k.id)}
                        className="rounded-md border border-status-critical/30 px-2 py-1 text-xs text-status-critical hover:bg-status-critical/15"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
                {keys.length === 0 && (
                  <p className="text-sm text-text-muted">No keys yet. Generate one to start ingesting.</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-text-muted">Select an application.</p>
          )}
        </div>
      </div>
    </Shell>
  );
}
