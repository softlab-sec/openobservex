"use client";
import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-white/5 p-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-white/50">
            Recover access to your OpenObserveX account.
          </p>
        </div>

        {/* Clearly marked as a placeholder while backend reset is finalized. */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <p className="font-medium">Coming soon</p>
          <p className="mt-1 text-amber-200/80">
            Password reset is currently being finalized. Please contact your
            administrator or support team for assistance.
          </p>
        </div>

        <div className="space-y-3 opacity-60">
          <div>
            <label className="mb-1 block text-xs font-medium text-white/50">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40"
            />
          </div>
          <button
            type="button"
            onClick={() => setSubmitted(true)}
            className="w-full rounded-lg border border-white/15 bg-white/[0.06] py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Send reset instructions
          </button>
          {submitted && (
            <p className="text-center text-xs text-white/50">
              If reset were enabled, instructions would be sent to your email.
              For now, please reach out to your administrator.
            </p>
          )}
        </div>

        <p className="text-center text-sm text-white/50">
          <Link href="/login" className="text-sky-400 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
