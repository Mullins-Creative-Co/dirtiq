import Link from "next/link";
import type { ReactNode } from "react";

/* Small, dependency-free building blocks used by the model pages.
 * Colors come from the tokens in globals.css; text never wears a data color. */

export function Kicker({ children }: { children: ReactNode }) {
  return <p className="kicker">{children}</p>;
}

export function PageHeader({ kicker, title, lede, aside }: { kicker: string; title: string; lede?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-col gap-5 border-b border-[var(--border)] pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <Kicker>{kicker}</Kicker>
        <h1 className="mt-2 font-display text-4xl font-black leading-[1.02] tracking-tight sm:text-5xl">{title}</h1>
        {lede ? <p className="mt-4 text-base leading-7 text-[var(--muted-strong)]">{lede}</p> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </header>
  );
}

export function Section({ title, kicker, description, action, children, id }: { title: string; kicker?: string; description?: ReactNode; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {kicker ? <Kicker>{kicker}</Kicker> : null}
          <h2 className="mt-1 font-display text-2xl font-black tracking-tight">{title}</h2>
          {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "", tone = "default" }: { children: ReactNode; className?: string; tone?: "default" | "raised" | "accent" }) {
  const base = tone === "raised" ? "panel-raised" : tone === "accent" ? "panel card-accent" : "panel";
  return <div className={`${base} ${className}`}>{children}</div>;
}

export type Tone = "good" | "warn" | "bad" | "neutral" | "accent";

const toneClass: Record<Tone, string> = {
  good: "chip chip-good",
  warn: "chip chip-warn",
  bad: "chip chip-bad",
  neutral: "chip chip-neutral",
  accent: "chip chip-accent",
};

export function Chip({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={toneClass[tone]} title={title}>{children}</span>;
}

export function StatTile({ label, value, detail, tone = "neutral", hint }: { label: string; value: ReactNode; detail?: ReactNode; tone?: Tone; hint?: string }) {
  return (
    <div className="stat" data-tone={tone} title={hint}>
      <p className="stat-label">{label}</p>
      <p className="stat-value tnum">{value}</p>
      {detail ? <p className="stat-detail">{detail}</p> : null}
    </div>
  );
}

/** A single-hue magnitude bar. Thin, square at the baseline, rounded at the data end. */
export function ProbBar({ value, max = 1, label, tone = "accent" }: { value: number; max?: number; label?: string; tone?: "accent" | "steel" | "good" }) {
  const width = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="prob-bar" role="img" aria-label={label ?? `${Math.round(width)} percent`}>
      <div className="prob-bar-fill" data-tone={tone} style={{ width: `${width}%` }} />
    </div>
  );
}

export function EmptyState({ title, detail, command, href, linkLabel }: { title: string; detail: ReactNode; command?: string; href?: string; linkLabel?: string }) {
  return (
    <div className="panel border-dashed p-6 text-sm">
      <p className="font-semibold text-white">{title}</p>
      <p className="mt-1 leading-6 text-[var(--muted)]">{detail}</p>
      {command ? <pre className="mt-3 overflow-x-auto rounded-md border border-[var(--border)] bg-black/40 px-3 py-2 font-mono text-xs text-[var(--muted-strong)]">{command}</pre> : null}
      {href ? <Link href={href} className="mt-3 inline-block text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">{linkLabel ?? "Open"} →</Link> : null}
    </div>
  );
}

export function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  return <p className={`note ${tone === "warn" ? "note-warn" : ""}`}>{children}</p>;
}

export function Table({ children, caption, className = "" }: { children: ReactNode; caption: string; className?: string }) {
  return (
    <div className={`table-wrap ${className}`}>
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
