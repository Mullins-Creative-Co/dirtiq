import Link from 'next/link';
import { Nav } from '@/components/nav';
import { FootballWorkbench } from '@/components/football/workbench';
import research from '../../../public/football/research.json';
import readiness from '../../../public/football/readiness.json';
import overlap from '../../../public/football/overlap.json';
import decomposition from '../../../public/football/decomposition.json';
import type { CastReport } from '@/lib/football/decomposition-types';
import type { OverlapAudit } from '@/lib/football/overlap-types';
import type { InputReadiness, ResearchReport } from '@/lib/football/research';
import college from '../../../public/football/college-turnovers.json';
import type { CollegeReport } from '@/lib/football/college-types';
import pricing from '../../../public/football/pricing-error.json';
import type { PricingReport } from '@/lib/football/pricing-types';

export const metadata = {
  title: 'Football Lab',
  description: 'Independent NFL modeling experiments, quarterback overlap checks, and historical line comparisons.',
};

export default function FootballPage() {
  return <><Nav /><main className="mx-auto max-w-6xl px-4 pb-28 pt-8 sm:px-6"><Link href="/matchups" className="mb-5 inline-block rounded border border-border-strong px-4 py-3 text-sm font-bold text-accent">Find and run a matchup →</Link><FootballWorkbench research={research as ResearchReport} readiness={readiness as InputReadiness} overlap={overlap as OverlapAudit} decomposition={decomposition as CastReport} college={college as CollegeReport} pricing={pricing as PricingReport} /></main></>;
}
