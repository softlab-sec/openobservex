export type Severity = "critical" | "warning" | "info";

type SevMeta = { label: string; dot: string; text: string; bg: string; border: string; bar: string };

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export const SEVERITY_META: Record<Severity, SevMeta> = {
  critical: { label: "Critical", dot: "bg-rose-500", text: "text-rose-300", bg: "bg-rose-500/10", border: "border-rose-500/40", bar: "bg-rose-500" },
  warning: { label: "Warning", dot: "bg-amber-400", text: "text-amber-300", bg: "bg-amber-400/10", border: "border-amber-400/40", bar: "bg-amber-400" },
  info: { label: "Info", dot: "bg-sky-400", text: "text-sky-300", bg: "bg-sky-400/10", border: "border-sky-400/40", bar: "bg-sky-400" },
};

export function sevMeta(s: string): SevMeta {
  return SEVERITY_META[s as Severity] ?? SEVERITY_META.warning;
}

export function sevRank(s: string): number {
  return SEVERITY_RANK[s as Severity] ?? 1;
}

export function since(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return Math.floor(secs) + "s";
  if (secs < 3600) return Math.floor(secs / 60) + "m";
  if (secs < 86400) return Math.floor(secs / 3600) + "h";
  return Math.floor(secs / 86400) + "d";
}

export function duration(startIso: string, endIso: string | null): string {
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const secs = Math.max(0, (end - new Date(startIso).getTime()) / 1000);
  if (secs < 60) return Math.floor(secs) + "s";
  if (secs < 3600) return Math.floor(secs / 60) + "m";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return m ? h + "h " + m + "m" : h + "h";
}
