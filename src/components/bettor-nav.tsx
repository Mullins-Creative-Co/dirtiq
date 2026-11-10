"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { BrandLink } from "@/components/brand";

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
        <BrandLink href="/sports/racing" tagline="Dirt racing book" />

        <nav className="flex items-center gap-2">
          <Link href="/" className="px-3 py-2 text-xs font-bold">Tonight</Link>
          <Link
            href={betHref}
            aria-current={onBoard ? "page" : undefined}
            className={`rounded-md px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition-colors ${
              onBoard
                ? "bg-gradient-to-b from-[var(--accent-hi)] to-[var(--accent-lo)] text-white shadow-[var(--glow-accent)]"
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
