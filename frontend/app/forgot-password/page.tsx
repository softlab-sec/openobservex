"use client";
import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface-elevated p-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-text-muted">
            Recover access to your OpenObserveX account.
          </p>
        </div>

        {/* Clearly marked as a placeholder while backend reset is finalized. */}
        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-status-warning">
          <p className="font-medium">Coming soon</p>
          <p className="mt-1 text-status-warning/80">
            Password reset is currently being finalized. Please contact your
            administrator or support team for assistance.
          </p>
        </div>

        <div className="space-y-3 opacity-60">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm outline-none focus:border-border"
            />
          </div>
          <button
            type="button"
            onClick={() => setSubmitted(true)}
            className="w-full rounded-lg border border-border bg-surface-elevated py-2 text-sm font-medium text-text-secondary transition hover:bg-surface-hover"
          >
            Send reset instructions
          </button>
          {submitted && (
            <p className="text-center text-xs text-text-muted">
              If reset were enabled, instructions would be sent to your email.
              For now, please reach out to your administrator.
            </p>
          )}
        </div>

        <p className="text-center text-sm text-text-muted">
          <Link href="/login" className="text-status-info hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
