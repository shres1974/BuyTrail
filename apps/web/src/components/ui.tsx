import type { ReactNode } from "react";

type Tone = "neutral" | "good" | "warn" | "bad" | "sample" | "teal";

const TONES: Record<Tone, string> = {
  neutral: "border-line bg-paper text-muted",
  good: "border-teal/30 bg-teal-soft text-teal-dark",
  teal: "border-teal/30 bg-teal-soft text-teal-dark",
  warn: "border-warn/30 bg-warn-soft text-warn",
  bad: "border-bad/30 bg-bad-soft text-bad",
  sample: "border-sample/30 bg-sample-soft text-sample",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function SampleBadge() {
  return <Badge tone="sample">Sample data</Badge>;
}

/** Real price from Google Shopping. Stock/fees follow the source's listing, not a checkout quote. */
export function LiveBadge() {
  return (
    <Badge tone="teal" title="Real price from Google Shopping (via SerpApi). Stock and fees as listed there; the retailer's checkout is authoritative.">
      Live price · Google Shopping
    </Badge>
  );
}

export function Notice({ tone = "neutral", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(20,33,61,0.04)] ${className}`}>{children}</div>;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{children}</h1>
      {sub && <p className="mt-1 text-muted">{sub}</p>}
    </div>
  );
}

export const buttonPrimary =
  "inline-flex items-center justify-center rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";
export const buttonSecondary =
  "inline-flex items-center justify-center rounded-md border border-line bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60";
export const inputClass =
  "block w-full rounded-md border border-[#9aa3b2] bg-card px-3 py-2 text-ink placeholder:text-[#6b7280] focus:border-teal aria-[invalid=true]:border-bad";
export const labelClass = "block text-sm font-medium text-ink";
