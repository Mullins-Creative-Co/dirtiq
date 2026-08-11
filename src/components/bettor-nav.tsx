"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

function CheckeredFlag({ size = 18 }: { size?: number }) {
  const sq = size / 4;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden="true">
      {[0, 1, 2, 3].flatMap((row) =>
        [0, 1, 2, 3].map((col) => {
          const on = (row + col) % 2 === 0;
          return (
            <rect
              key={`${row}-${col}`}
              x={col * sq}
              y={row * sq}
              width={sq}
              height={sq}
              fill={on ? "#0b0d10" : "transparent"}
              fillOpacity={on ? 0.92 : 0}
            />
          );
        })
      )}
    </svg>
  );
}

export function BettorNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const name = searchParams.get("name");
  const betHref = name ? `/bet?name=${encodeURIComponent(name)}` : "/bet";
  const onBoard = pathname === "/bet";

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_86%,transparent)] backdrop-blur-md">
      <div className="brand-rule" />
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href={betHref} className="group flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-b from-[var(--accent-hi)] to-[var(--accent-lo)] shadow-[0_6px_18px_-8px_var(--accent)]">
            <CheckeredFlag size={18} />
          </span>
          <span className="flex flex-col leading-none">
            <span
              style={{ fontFamily: "var(--font-display)" }}
              className="text-xl font-extrabold tracking-tight"
            >
              <span className="text-[var(--accent)]">dirt</span>
              <span className="text-white">IQ</span>
            </span>
            <span className="mt-0.5 hidden text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)] sm:block">
              Late Model Sportsbook
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link
            href={betHref}
            aria-current={onBoard ? "page" : undefined}
            className={`rounded-md px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition-colors ${
              onBoard
                ? "bg-gradient-to-b from-[var(--accent-hi)] to-[var(--accent-lo)] text-[#0b0d10] shadow-[var(--glow-accent)]"
                : "border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted-strong)] hover:border-[var(--accent)]/50 hover:text-white"
            }`}
          >
            Board
          </Link>
          {name ? (
            <span className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[10px] font-black uppercase text-[var(--accent)]">
                {name.slice(0, 2)}
              </span>
              <span className="max-w-[9rem] truncate text-xs font-semibold text-white">{name}</span>
            </span>
          ) : (
            <Link
              href="/bet"
              className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted-strong)] transition-colors hover:border-[var(--accent)]/50 hover:text-white"
            >
              Sign In
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
