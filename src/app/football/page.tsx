import { Nav } from '@/components/nav';
import { FootballWorkbench } from '@/components/football/workbench';

export const metadata = {
  title: 'Football Lab | dirtIQ',
  description: 'Independent NFL modeling experiments, quarterback overlap checks, and historical line comparisons.',
};

export default function FootballPage() {
  return <><Nav /><main className="mx-auto max-w-6xl px-4 pb-28 pt-8 sm:px-6"><FootballWorkbench /></main></>;
}
