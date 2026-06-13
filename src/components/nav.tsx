"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/races", label: "Races" },
  { href: "/drivers", label: "Drivers" },
  { href: "/tracks", label: "Tracks" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-1">
          <span className="text-xl font-black tracking-tight text-[var(--accent)]">dirt</span>
          <span className="text-xl font-black tracking-tight text-white">IQ</span>
        </Link>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-[var(--accent)] text-black" : "text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-white"}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/races/new" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 transition-opacity">
          + New Race
        </Link>
      </div>
    </header>
  );
}
