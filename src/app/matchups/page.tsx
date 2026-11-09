import { Nav } from '@/components/nav';
import { MatchupWorkbench } from '@/components/matchups/workbench';
import { getBundledMatchups } from '@/lib/matchups/catalog';

export const metadata = {
  title: 'Matchups | dirtIQ',
  description: 'Find and run NFL, NBA, college football and college basketball matchups in one workspace.',
};

// The date picker must reflect the request date, not the last deployment date.
export const dynamic = 'force-dynamic';

export default function MatchupsPage() {
  return <><Nav /><main className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6">
    <MatchupWorkbench archivedGames={getBundledMatchups()} today={new Date().toISOString().slice(0, 10)} />
  </main></>;
}
