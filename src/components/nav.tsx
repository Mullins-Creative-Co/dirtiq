"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type Item = { href: string; label: string; match?: (path: string) => boolean };
type Group = { key: string; label: string; href: string; items: Item[]; match: (path: string) => boolean };

const starts = (prefixes: string[]) => (path: string) => prefixes.some((p) => (p === "/" ? path === "/" : path === p || path.startsWith(`${p}/`)));

const groups: Group[] = [
  { key: "home", label: "Home", href: "/", match: (path) => path === "/", items: [] },
  {
    key: "racing", label: "Racing", href: "/admin/today",
    match: starts(["/admin/today", "/admin/live", "/admin/races", "/admin/risk", "/admin/accuracy", "/admin/backtest", "/admin/model", "/admin/upcoming", "/admin/featured-lines", "/bet", "/bettor", "/bettors", "/race", "/preview", "/odds"]),
    items: [
      { href: "/admin/today", label: "Today board" },
      { href: "/admin/races", label: "Races" },
      { href: "/admin/live", label: "Control" },
      { href: "/admin/risk", label: "Book & risk" },
      { href: "/bet", label: "Bettor lobby", match: starts(["/bet", "/bettor", "/bettors", "/race"]) },
      { href: "/admin/accuracy", label: "Accuracy" },
      { href: "/preview/world-100", label: "World 100", match: starts(["/preview", "/odds"]) },
    ],
  },
  {
    key: "sports", label: "Sports", href: "/sports",
    match: starts(["/sports", "/matchups"]),
    items: [
      { href: "/sports", label: "All sports", match: (path) => path === "/sports" },
      { href: "/sports/nfl", label: "NFL" },
      { href: "/sports/nba", label: "NBA" },
      { href: "/sports/ncaaf", label: "College football" },
      { href: "/matchups", label: "Matchup workbench" },
    ],
  },
  {
    key: "models", label: "Models", href: "/models",
    match: starts(["/models", "/admin/testing", "/football", "/nba"]),
    items: [
      { href: "/models", label: "Health", match: (path) => path === "/models" },
      { href: "/admin/testing", label: "Racing lab" },
      { href: "/football", label: "Football lab" },
      { href: "/nba", label: "NBA lab" },
    ],
  },
  {
    key: "manage", label: "Manage", href: "/admin/maintenance",
    match: starts(["/admin/maintenance", "/admin/import", "/admin/storage", "/admin/drivers", "/admin/tracks"]),
    items: [
      { href: "/admin/maintenance", label: "Refresh" },
      { href: "/admin/import", label: "Import" },
      { href: "/admin/drivers", label: "Drivers" },
      { href: "/admin/tracks", label: "Tracks" },
      { href: "/admin/storage", label: "Storage" },
    ],
  },
];

const mobileDock = [
  { href: "/", label: "Home" },
  { href: "/admin/today", label: "Racing" },
  { href: "/sports", label: "Sports" },
  { href: "/models", label: "Models" },
];

function Flag({ size = 18 }: { size?: number }) {
  const sq = size / 4;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden="true">
      {[0, 1, 2, 3].flatMap((row) => [0, 1, 2, 3].map((col) => (
        <rect key={`${row}-${col}`} x={col * sq} y={row * sq} width={sq} height={sq} fill="white" fillOpacity={(row + col) % 2 === 0 ? 0.92 : 0} />
      )))}
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const activeGroup = groups.find((g) => g.match(pathname)) ?? groups[0];
  const itemActive = (item: Item) => (item.match ? item.match(pathname) : pathname === item.href || pathname.startsWith(`${item.href}/`));

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur">
        <div className="brand-rule" />
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 py-3" onClick={() => setOpen(false)}>
            <span className="border border-white/20 p-[3px]"><Flag /></span>
            <span style={{ fontFamily: "var(--font-display)" }} className="text-2xl font-black leading-none tracking-tight">
              <span className="text-[var(--accent)]">dirt</span><span className="text-white">IQ</span>
            </span>
          </Link>

          <nav aria-label="Primary" className="hidden items-stretch md:flex">
            {groups.map((g) => (
              <Link key={g.key} href={g.href} className="nav-link" data-active={g.key === activeGroup.key}>{g.label}</Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {activeGroup.key === "racing" ? (
              <Link href="/admin/races/new" className="btn-accent hidden px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] md:block">New race</Link>
            ) : null}
            <button className="p-2 text-[var(--muted)] hover:text-white md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu" aria-expanded={open}>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                {open ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
              </svg>
            </button>
          </div>
        </div>

        {activeGroup.items.length > 0 ? (
          <div className="border-t border-[var(--border)]">
            <nav aria-label={`${activeGroup.label} sections`} className="nav-sub mx-auto max-w-7xl px-2 sm:px-4">
              {activeGroup.items.map((item) => (
                <Link key={item.href} href={item.href} className="nav-sub-link" data-active={itemActive(item)}>{item.label}</Link>
              ))}
            </nav>
          </div>
        ) : null}

        {open ? (
          <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 pb-4 pt-2 md:hidden">
            {groups.map((g) => (
              <div key={g.key} className="py-1">
                <Link href={g.href} onClick={() => setOpen(false)} className="nav-link block px-0" data-active={g.key === activeGroup.key}>{g.label}</Link>
                {g.items.length > 0 ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pb-1 pl-3">
                    {g.items.map((item) => (
                      <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="text-xs text-[var(--muted-strong)]">{item.label}</Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </header>

      <nav aria-label="Mobile sections" className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-[#080808]/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-2 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1.5">
          {mobileDock.map((item) => {
            const active = item.href === "/" ? pathname === "/" : (groups.find((g) => g.href === item.href)?.match(pathname) ?? false);
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                className={`min-h-11 rounded-md border px-2 py-2 text-center text-[10px] font-black uppercase tracking-wide ${active ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)]"}`}>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
