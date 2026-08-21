"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import { COUNTRIES, flagFor, type Country } from "@/lib/identity-data";

// Emits the full E.164 value (e.g. "+2348012345678") to onChange. Keeps the
// country and the national digits as internal state.
export default function PhoneInput({
  value,
  onChange,
  onValidityChange,
}: {
  value: string;
  onChange: (e164: string) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [country, setCountry] = useState<Country>(
    COUNTRIES.find((c) => c.code === "NG") ?? COUNTRIES[0]
  );
  const [national, setNational] = useState("");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // Close the country menu on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? COUNTRIES.filter(
          (c) =>
            c.name.toLowerCase().includes(term) ||
            c.dial.includes(term) ||
            c.code.toLowerCase() === term
        )
      : COUNTRIES;
    // pinned first, then alpha (COUNTRIES is already in that order)
    return list;
  }, [q]);

  // Digits only, reasonable international length (E.164 national part <= 14).
  const digits = national.replace(/\D/g, "");
  const valid = digits.length >= 6 && digits.length <= 14;

  useEffect(() => {
    onChange(digits ? `${country.dial}${digits}` : "");
    onValidityChange?.(digits.length === 0 || valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, national]);

  return (
    <div className="flex gap-2" ref={boxRef}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-full items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2.5 text-sm text-white/80 outline-none transition hover:border-white/25 focus:border-white/40"
          aria-label="Select country"
        >
          <span className="text-base leading-none">{flagFor(country.code)}</span>
          <span className="tabular-nums text-white/60">{country.dial}</span>
          <svg width="10" height="10" viewBox="0 0 12 12" className="opacity-50">
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </button>
        {open && (
          <div className="absolute z-20 mt-1 max-h-72 w-72 overflow-auto rounded-lg border border-white/15 bg-neutral-900/95 p-1 shadow-xl backdrop-blur">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search country or code"
              className="mb-1 w-full rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-sm outline-none focus:border-white/30"
            />
            {filtered.map((c, i) => {
              const prevPinned = i > 0 && filtered[i - 1].pinned;
              const divider = prevPinned && !c.pinned;
              return (
                <div key={c.code}>
                  {divider && <div className="my-1 border-t border-white/10" />}
                  <button
                    type="button"
                    onClick={() => {
                      setCountry(c);
                      setOpen(false);
                      setQ("");
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-white/10 ${
                      c.code === country.code ? "bg-white/5" : ""
                    }`}
                  >
                    <span className="text-base leading-none">{flagFor(c.code)}</span>
                    <span className="flex-1 truncate text-white/80">{c.name}</span>
                    <span className="tabular-nums text-white/40">{c.dial}</span>
                  </button>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-white/30">No match</p>
            )}
          </div>
        )}
      </div>
      <input
        type="tel"
        inputMode="numeric"
        value={national}
        onChange={(e) => setNational(e.target.value)}
        placeholder="801 234 5678"
        className={`w-full rounded-lg border bg-black/30 px-3 py-2 text-sm outline-none transition ${
          national && !valid
            ? "border-red-500/50 focus:border-red-500/70"
            : "border-white/10 focus:border-white/40"
        }`}
      />
    </div>
  );
}
