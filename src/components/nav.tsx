"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const adminItems = [
  { href: "/admin/live", label: "Control" },
  { href: "/admin/testing", label: "Model Lab" },
  { href: "/admin/races", label: "Races" },
  { href: "/admin/maintenance", label: "Refresh" },
];

const mobileDockItems = [
  { href: "/admin/live", label: "Control" },
  { href: "/admin/testing", label: "Model" },
  { href: "/admin/races", label: "Races" },
  { href: "/admin/maintenance", label: "Refresh" },
];

function CheckeredFlag({ size = 20 }: { size?: number }) {
  const sq = size / 4;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {/* 4×4 checkered grid */}
      {[0,1,2,3].flatMap((row) =>
        [0,1,2,3].map((col) => {
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

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isAdmin = pathname.startsWith("/admin");

  function adminLinkClass(href: string) {
    const active = pathname.startsWith(href);
    return `relative px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
      active
        ? "text-[var(--accent)] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--accent)] after:content-['']"
        : "text-[var(--muted)] hover:text-white"
    }`;
  }

  return (
    <>
    <header className="bg-[var(--surface)] border-b border-[var(--border)]">
      <div className="h-[3px] bg-[linear-gradient(90deg,var(--racing-red)_0%,var(--racing-red)_18%,var(--accent)_34%,var(--accent)_64%,#91a4b7_82%,#91a4b7_100%)]" />

      {/* Main bar */}
      <div className="mx-auto flex max-w-6xl items-stretch justify-between px-4 sm:px-6">

        {/* Logo */}
        <Link
          href="/admin/live"
          className="flex items-center gap-2.5 py-3 mr-6"
          onClick={() => setOpen(false)}
        >
          <div className="border border-white/20 p-[3px]">
            <CheckeredFlag size={20} />
          </div>
          <span style={{ fontFamily: "var(--font-display)" }} className="text-2xl font-black tracking-tight leading-none">
            <span className="text-[var(--accent)]">dirt</span>
            <span className="text-white">IQ</span>
          </span>
          <span className="hidden border-l border-[var(--border)] pl-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)] lg:inline">
            Model Control
          </span>
        </Link>

        {/* Right actions */}
        <div className="flex items-center gap-2 ml-auto">
          {isAdmin && (
            <Link
              href="/admin/races/new"
              className="hidden md:block bg-[var(--accent)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black hover:opacity-90 transition-opacity"
            >
              New Race
            </Link>
          )}
          <button
            className="md:hidden p-2 text-[var(--muted)] hover:text-white transition-colors"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {open ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Single-tool nav (desktop) */}
      {(isAdmin || pathname === "/") && (
        <div className="border-t border-[var(--border)] bg-[var(--surface)]">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
            <div className="hidden md:flex items-stretch gap-0">
              <Link href="/admin/live" className={adminLinkClass("/admin/live")}>Control</Link>
              <Link href="/admin/testing" className={adminLinkClass("/admin/testing")}>Model Lab</Link>
              <Link href="/admin/races" className={adminLinkClass("/admin/races")}>Races</Link>
            </div>
            <div className="hidden items-center gap-2 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)] md:flex">
              <Link href="/admin/maintenance" className="hover:text-white">Refresh</Link>
              <span className="text-[var(--border)]">/</span>
              <Link href="/admin/accuracy" className="hover:text-white">Backtest</Link>
            </div>
          </div>
        </div>
      )}

      {/* Mobile menu drawer */}
      {open && (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--surface)]">
          {(isAdmin || pathname === "/") && (
            <div className="border-t border-[var(--border)] px-4 py-2 space-y-0.5">
              {adminItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`block ${adminLinkClass(item.href)}`}
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/admin/races/new"
                onClick={() => setOpen(false)}
                className="mt-3 block bg-[var(--accent)] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-black hover:opacity-90 text-center"
              >
                New Race
              </Link>
              <Link
                href="/admin/races"
                onClick={() => setOpen(false)}
                className="block px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)] hover:text-white"
              >
                All races
              </Link>
              <Link
                href="/admin/maintenance"
                onClick={() => setOpen(false)}
                className="block px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)] hover:text-white"
              >
                Refresh
              </Link>
              <Link
                href="/admin/accuracy"
                onClick={() => setOpen(false)}
                className="block px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)] hover:text-white"
              >
                Backtest
              </Link>
            </div>
          )}
        </div>
      )}
    </header>

    {isAdmin && (
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-[#080a0d]/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-2 shadow-2xl shadow-black/60 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1.5">
          {mobileDockItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`min-h-11 border px-2 py-2 text-center text-[10px] font-black uppercase tracking-wide ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent)] text-black"
                    : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    )}
    </>
  );
}
