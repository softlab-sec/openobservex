"use client";
import { useMemo, useState } from "react";

export type PwChecks = {
  length: boolean;
  upper: boolean;
  lower: boolean;
  number: boolean;
  special: boolean;
};

export function evaluatePassword(pw: string): PwChecks {
  return {
    length: pw.length >= 12,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
}

export function passwordValid(pw: string): boolean {
  const c = evaluatePassword(pw);
  return c.length && c.upper && c.lower && c.number && c.special;
}

const RULES: { key: keyof PwChecks; label: string }[] = [
  { key: "length", label: "At least 12 characters" },
  { key: "upper", label: "An uppercase letter" },
  { key: "lower", label: "A lowercase letter" },
  { key: "number", label: "A number" },
  { key: "special", label: "A special character" },
];

export default function PasswordField({
  value,
  onChange,
  placeholder = "Create a password",
  showMeter = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  showMeter?: boolean;
}) {
  const [show, setShow] = useState(false);
  const checks = useMemo(() => evaluatePassword(value), [value]);
  const score = Object.values(checks).filter(Boolean).length;

  const meter =
    score <= 2
      ? { w: "33%", cls: "bg-red-500", label: "Weak" }
      : score <= 4
        ? { w: "66%", cls: "bg-amber-500", label: "Fair" }
        : { w: "100%", cls: "bg-emerald-500", label: "Strong" };

  return (
    <div>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 pr-16 text-sm outline-none focus:border-white/40"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-white/40 transition hover:text-white/70"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {showMeter && value.length > 0 && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full transition-all ${meter.cls}`} style={{ width: meter.w }} />
            </div>
            <span className="w-12 text-right text-[11px] text-white/50">{meter.label}</span>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
            {RULES.map((r) => (
              <li
                key={r.key}
                className={`flex items-center gap-1.5 text-[11px] ${
                  checks[r.key] ? "text-emerald-400/80" : "text-white/35"
                }`}
              >
                <span className="text-[10px]">{checks[r.key] ? "✓" : "○"}</span>
                {r.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
