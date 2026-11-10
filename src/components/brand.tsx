import Link from "next/link";

import { SITE_NAME, wordmarkParts } from "@/lib/site";

/** Neutral brand mark: three rising bars, the shape of a forecast getting sharper. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="shrink-0" aria-hidden="true">
      <rect x="2" y="11" width="4" height="7" rx="1" fill="currentColor" fillOpacity="0.55" />
      <rect x="8" y="6" width="4" height="12" rx="1" fill="currentColor" fillOpacity="0.8" />
      <rect x="14" y="2" width="4" height="16" rx="1" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ size = "text-2xl", tagline }: { size?: string; tagline?: string }) {
  const [lead, tail] = wordmarkParts();
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-[var(--surface-raised)] text-[var(--accent)]">
        <BrandMark size={18} />
      </span>
      <span className="flex flex-col leading-none">
        <span style={{ fontFamily: "var(--font-display)" }} className={`${size} font-black leading-none tracking-tight`}>
          <span className="text-[var(--accent)]">{lead}</span>
          <span className="text-white">{tail}</span>
        </span>
        {tagline ? <span className="mt-0.5 hidden text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)] sm:block">{tagline}</span> : null}
      </span>
    </span>
  );
}

export function BrandLink({ href = "/", onClick, tagline }: { href?: string; onClick?: () => void; tagline?: string }) {
  return (
    <Link href={href} className="py-3" onClick={onClick} aria-label={`${SITE_NAME} home`}>
      <Wordmark tagline={tagline} />
    </Link>
  );
}
