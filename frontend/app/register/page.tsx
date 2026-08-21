"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, register, setToken, type RegisterPayload } from "@/lib/api";
import PhoneInput from "@/components/PhoneInput";
import JobTitleSelect from "@/components/JobTitleSelect";
import PasswordField, { passwordValid } from "@/components/PasswordField";

const SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
const INDUSTRIES = [
  "Technology", "Financial Services", "Healthcare", "Retail / E-commerce",
  "Telecommunications", "Government / Public Sector", "Education", "Other",
];

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40";
const labelCls = "mb-1 block text-xs font-medium text-white/50";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone: "",
    job_title: "", department: "", organization_name: "", industry: "",
    company_size: "", country: "", password: "", confirm: "",
  });
  const [phoneValid, setPhoneValid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError("Please enter your first and last name."); return;
    }
    if (!form.job_title.trim()) {
      setError("Please select or enter your job title."); return;
    }
    if (!passwordValid(form.password)) {
      setError("Your password does not meet the security requirements."); return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords do not match."); return;
    }
    if (!phoneValid) {
      setError("Please enter a valid phone number, or leave it blank."); return;
    }
    const payload: RegisterPayload = {
      full_name: `${form.first_name.trim()} ${form.last_name.trim()}`,
      email: form.email.trim(),
      password: form.password,
      job_title: form.job_title.trim() || undefined,
      department: form.department.trim() || undefined,
      phone: form.phone.trim() || undefined,
      organization_name: form.organization_name.trim() || form.email.split("@")[1] || "My Organization",
      industry: form.industry || undefined,
      company_size: form.company_size || undefined,
      country: form.country.trim() || undefined,
    };
    setLoading(true);
    try {
      await register(payload);
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
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-sm font-bold">OX</div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Create your OpenObserveX account</h1>
            <p className="text-sm text-white/45">Identity &amp; Access Management</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
          {/* Personal */}
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white/80">Personal information</h2>
            <div className="h-px flex-1 bg-white/10" />
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>First name *</label>
              <input required value={form.first_name} onChange={(e) => set("first_name", e.target.value)} placeholder="Ada" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Last name *</label>
              <input required value={form.last_name} onChange={(e) => set("last_name", e.target.value)} placeholder="Lovelace" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email address *</label>
              <input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@company.com" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone number *</label>
              <PhoneInput value={form.phone} onChange={(v) => set("phone", v)} onValidityChange={setPhoneValid} />
            </div>
          </div>

          {/* Organization */}
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white/80">Organization</h2>
            <div className="h-px flex-1 bg-white/10" />
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Organization name</label>
              <input value={form.organization_name} onChange={(e) => set("organization_name", e.target.value)} placeholder="Acme Inc" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Job title *</label>
              <JobTitleSelect value={form.job_title} onChange={(v) => set("job_title", v)} />
            </div>
            <div>
              <label className={labelCls}>Department</label>
              <input value={form.department} onChange={(e) => set("department", e.target.value)} placeholder="Platform, Security, SRE..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Company size</label>
              <select value={form.company_size} onChange={(e) => set("company_size", e.target.value)} className={inputCls}>
                <option value="">Select...</option>
                {SIZES.map((s) => (<option key={s} value={s}>{s} employees</option>))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Industry</label>
              <select value={form.industry} onChange={(e) => set("industry", e.target.value)} className={inputCls}>
                <option value="">Select...</option>
                {INDUSTRIES.map((i) => (<option key={i} value={i}>{i}</option>))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Country</label>
              <input value={form.country} onChange={(e) => set("country", e.target.value)} placeholder="Nigeria" className={inputCls} />
            </div>
          </div>

          {/* Security */}
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white/80">Security</h2>
            <div className="h-px flex-1 bg-white/10" />
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Password *</label>
              <PasswordField value={form.password} onChange={(v) => set("password", v)} />
            </div>
            <div>
              <label className={labelCls}>Confirm password *</label>
              <PasswordField value={form.confirm} onChange={(v) => set("confirm", v)} placeholder="Re-enter your password" showMeter={false} />
              {form.confirm.length > 0 && form.confirm !== form.password && (
                <p className="mt-1 text-[11px] text-red-400">Passwords do not match.</p>
              )}
            </div>
          </div>

          {error && (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>
          )}
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-white py-2.5 font-medium text-black transition disabled:opacity-50">
            {loading ? "Creating account..." : "Create account"}
          </button>

          <p className="mt-4 text-center text-xs text-white/40">
            By creating an account you agree to your organization&apos;s security and access policies.
          </p>
          <p className="mt-3 text-center text-sm text-white/50">
            Already have an account?{" "}
            <Link href="/login" className="text-sky-400 hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
