// Frontend role gating — mirrors the backend's require_role tiers.
//
// This is UX only: it hides actions a user cannot perform so they don't see
// buttons that would return 403. The REAL enforcement is server-side
// (app/core/roles.py). Never rely on this for security.
//
// Tiers: admin > member > viewer.

import { createContext, useContext } from "react";

export type Role = "admin" | "member" | "viewer";

// Current user's role, provided by Shell. Undefined until /me resolves.
export const RoleContext = createContext<string | undefined>(undefined);

export function useRole(): string | undefined {
  return useContext(RoleContext);
}

// admin-only: config/security actions (delete, manage keys/apps/channels).
export function canManage(role?: string): boolean {
  return role === "admin";
}

// admin or member: operational actions (create/edit rules, ack/resolve
// incidents, resolve/dismiss/escalate anomalies, maintenance windows).
export function canOperate(role?: string): boolean {
  return role === "admin" || role === "member";
}
