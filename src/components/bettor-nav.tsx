"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

function CheckeredFlag({ size = 20 }: { size?: number }) {
  const sq = size / 4;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {[0, 1, 2, 3].flatMap((row) =>
        [0, 1, 2, 3].map((col) => {
          const fill = (row + col) % 2 === 0 ? "white" : "transparent";
          return (
            <rect
              key={`${row}-${col}`}
              x={col * sq}
              y={row * sq}
              width={sq}
              height={sq}
              fill={fill}
              fillOpacity={fill === "white" ? 0.9 : 0}
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

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="h-[3px] bg-[linear-gradient(90deg,var(--racing-red)_0%,var(--racing-red)_22%,var(--accent)_42%,var(--accent)_72%,#91a4b7_100%)]" />
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href={betHref} className="flex items-center gap-2.5">
          <div className="border border-white/20 p-[3px]">
            <CheckeredFlag size={20} />
          </div>
          <span style={{ fontFamily: "var(--font-display)" }} className="text-2xl font-black leading-none tracking-tight">
            <span className="text-[var(--accent)]">dirt</span>
            <span className="text-white">IQ</span>
          </span>
          <span className="hidden border-l border-[var(--border)] pl-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)] sm:inline">
            Betting Board
          </span>
        </Link>

        <nav className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em]">
          <Link
            href={betHref}
            className={`border px-3 py-2 ${
              pathname === "/bet"
                ? "border-[var(--accent)] bg-[var(--accent)] text-black"
                : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)] hover:text-white"
            }`}
          >
            Board
          </Link>
        </nav>
      </div>
    </header>
  );
}
