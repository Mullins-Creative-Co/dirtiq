import { Nav } from '@/components/nav';
import { FootballWorkbench } from '@/components/football/workbench';
import research from '../../../public/football/research.json';
import readiness from '../../../public/football/readiness.json';
import overlap from '../../../public/football/overlap.json';
import type { OverlapAudit } from '@/lib/football/overlap-types';
import type { InputReadiness, ResearchReport } from '@/lib/football/research';

export const metadata = {
  title: 'Football Lab | dirtIQ',
  description: 'Independent NFL modeling experiments, quarterback overlap checks, and historical line comparisons.',
};

export default function FootballPage() {
  return <><Nav /><main className="mx-auto max-w-6xl px-4 pb-28 pt-8 sm:px-6"><FootballWorkbench research={research as ResearchReport} readiness={readiness as InputReadiness} overlap={overlap as OverlapAudit} /></main></>;
}
