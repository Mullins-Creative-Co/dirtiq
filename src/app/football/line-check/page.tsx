import Link from 'next/link';
import { Nav } from '@/components/nav';
import { LineCheck } from '@/components/football/line-check';

export const metadata = {
  title: 'Football Line Check | dirtIQ',
  description: 'Combine matchup adjustments and compare the projected margin with a sportsbook spread and price.',
};

export default function LineCheckPage() {
  return <><Nav /><main className="mx-auto max-w-6xl px-4 pb-28 pt-8 sm:px-6">
    <Link href="/football" className="text-sm text-accent underline">Football Lab</Link>
    <LineCheck />
  </main></>;
}
