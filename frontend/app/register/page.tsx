"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, register, setToken, type RegisterPayload } from "@/lib/api";

const SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
const INDUSTRIES = [
  "Technology",
  "Financial Services",
  "Healthcare",
  "Retail / E-commerce",
  "Telecommunications",
  "Government / Public Sector",
  "Education",
  "Other",
];

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40";
const labelCls = "mb-1 block text-xs uppercase tracking-wider text-white/40";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    confirm: "",
    job_title: "",
    phone: "",
    organization_name: "",
    industry: "",
    company_size: "",
    country: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }

    const payload: RegisterPayload = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      password: form.password,
      organization_name: form.organization_name.trim(),
      job_title: form.job_title.trim() || undefined,
      phone: form.phone.trim() || undefined,
      industry: form.industry || undefined,
      company_size: form.company_size || undefined,
      country: form.country.trim() || undefined,
    };

    setLoading(true);
    try {
      await register(payload);
      // log straight in so the user lands on the dashboard
      const token = await login(payload.email, payload.password);
      setToken(token);
      router.replace("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-white/[0.03] p-8"
      >
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create your OpenObserveX account
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Sets up your organization and makes you its admin.
          </p>
        </div>

        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-white/40">
          About you
        </h2>
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Full name *</label>
            <input
              required
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              placeholder="Jane Doe"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Work email *</label>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="jane@company.com"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Job title</label>
            <input
              value={form.job_title}
              onChange={(e) => set("job_title", e.target.value)}
              placeholder="Site Reliability Engineer"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+234..."
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Password *</label>
            <input
              required
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder="At least 8 characters"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Confirm password *</label>
            <input
              required
              type="password"
              value={form.confirm}
              onChange={(e) => set("confirm", e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-white/40">
          Your company
        </h2>
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls}>Company name *</label>
            <input
              required
              value={form.organization_name}
              onChange={(e) => set("organization_name", e.target.value)}
              placeholder="Acme Inc"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Industry</label>
            <select
              value={form.industry}
              onChange={(e) => set("industry", e.target.value)}
              className={inputCls}
            >
              <option value="">Select...</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Company size</label>
            <select
              value={form.company_size}
              onChange={(e) => set("company_size", e.target.value)}
              className={inputCls}
            >
              <option value="">Select...</option>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} employees
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Country</label>
            <input
              value={form.country}
              onChange={(e) => set("country", e.target.value)}
              placeholder="Nigeria"
              className={inputCls}
            />
          </div>
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-white py-2.5 font-medium text-black transition disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Create account"}
        </button>

        <p className="mt-4 text-center text-sm text-white/50">
          Already have an account?{" "}
          <Link href="/login" className="text-sky-400 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
