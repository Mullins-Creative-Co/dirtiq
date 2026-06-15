"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const adminItems = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/races", label: "Races" },
  { href: "/admin/risk", label: "Risk" },
  { href: "/admin/drivers", label: "Drivers" },
  { href: "/admin/tracks", label: "Tracks" },
  { href: "/admin/model", label: "Stats" },
  { href: "/admin/import", label: "Import" },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isAdmin = pathname.startsWith("/admin");

  function linkClass(href: string) {
    const active = href === "/admin"
      ? pathname === "/admin"
      : pathname.startsWith(href);
    return `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-[var(--accent)] text-black" : "text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-white"}`;
  }

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-4">
        <Link href="/" className="flex items-center gap-1" onClick={() => setOpen(false)}>
          <span className="text-xl font-black tracking-tight text-[var(--accent)]">dirt</span>
          <span className="text-xl font-black tracking-tight text-white">IQ</span>
        </Link>

        {isAdmin ? (
          <>
            {/* Desktop admin nav */}
            <nav className="hidden md:flex items-center gap-1">
              {adminItems.map((item) => (
                <Link key={item.href} href={item.href} className={linkClass(item.href)}>
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <Link href="/admin/races/new" className="hidden md:block rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 transition-opacity">
                + New Race
              </Link>
              <button
                className="md:hidden rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-white transition-colors"
                onClick={() => setOpen((v) => !v)}
                aria-label="Toggle menu"
              >
                {open ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </>
        ) : (
          <Link href="/admin" className="text-xs text-[var(--muted)] hover:text-white transition-colors">
            Admin →
          </Link>
        )}
      </div>

      {/* Mobile admin menu */}
      {isAdmin && open && (
        <div className="md:hidden border-t border-[var(--border)] px-4 py-3 space-y-1">
          {adminItems.map((item) => (
            <Link key={item.href} href={item.href}
              onClick={() => setOpen(false)}
              className={`block ${linkClass(item.href)}`}>
              {item.label}
            </Link>
          ))}
          <Link href="/admin/races/new"
            onClick={() => setOpen(false)}
            className="mt-2 block rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-black hover:opacity-90 text-center">
            + New Race
          </Link>
        </div>
      )}
    </header>
  );
}
