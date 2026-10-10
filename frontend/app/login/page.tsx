"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { login, setToken, apiGet, type OidcStatus } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const expired = params.get("expired") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sso, setSso] = useState<OidcStatus | null>(null);

  // Land the SSO token (callback redirects here with ?sso_token=...), or show
  // an SSO error (?sso_error=...).
  useEffect(() => {
    const t = params.get("sso_token");
    if (t) {
      setToken(t);
      router.replace("/dashboard");
      return;
    }
    const e = params.get("sso_error");
    if (e) {
      const msgs: Record<string, string> = {
        domain_not_allowed: "Your email domain is not authorized for SSO.",
        account_disabled: "Your account is disabled. Contact an administrator.",
        email_unverified: "Your email is not verified with the identity provider.",
        token_validation_failed: "Sign-in could not be verified. Please try again.",
        bad_state: "The sign-in request expired or was invalid. Please try again.",
      };
      setError(msgs[e] ?? "Single sign-on failed. Please try again.");
    }
  }, [params, router]);

  // Show the SSO button only when the server reports it enabled.
  useEffect(() => {
    apiGet<OidcStatus>("/api/v1/auth/oidc/status").then(setSso).catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const token = await login(email, password);
      setToken(token);
      router.replace("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface-elevated p-8"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">OpenObserveX</h1>
          <p className="mt-1 text-sm text-text-muted">Sign in to your account</p>
        </div>
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 outline-none focus:border-border"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 outline-none focus:border-border"
        />
        <div className="text-right">
          <Link href="/forgot-password" className="text-xs text-text-muted transition hover:text-text-secondary">
            Forgot password?
          </Link>
        </div>
        {expired && !error && (
          <p className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-2 text-sm text-status-warning">
            Your session expired. Please sign in again.
          </p>
        )}
        {error && <p className="text-sm text-status-critical">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-surface-card py-2 font-medium text-text-primary transition disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
        {sso?.enabled && (
          <>
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <div className="h-px flex-1 bg-surface-hover" />
              or
              <div className="h-px flex-1 bg-surface-hover" />
            </div>
            
              <a
              href="/api/v1/auth/oidc/login"
              className="block w-full rounded-lg border border-border bg-surface-elevated py-2 text-center font-medium text-text-secondary transition hover:bg-surface-elevated"
            >
              Sign in with {sso.provider_name}
            </a>
          </>
        )}
        <p className="text-center text-sm text-text-muted">
          No account?{" "}
          <Link href="/register" className="text-status-info hover:underline">
            Create one
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
