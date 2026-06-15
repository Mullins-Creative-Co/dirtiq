import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { getTrack, getTrackSimilars, listTracks } from "@/lib/tracks";
import { TrackIntelligenceEditor } from "@/components/track-intelligence-editor";
import { getDb } from "@/lib/db";

export default async function TrackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const trackId = parseInt(id, 10);
  if (isNaN(trackId)) notFound();

  const track = getTrack(trackId);
  if (!track) notFound();

  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const similars = plain(getTrackSimilars(trackId));
  const allTracks = plain(listTracks().filter((t) => t.id !== trackId));

  const races = getDb().prepare(`
    SELECT r.id, r.name, r.race_date, r.status, COUNT(re.id) AS entry_count
    FROM races r
    LEFT JOIN race_entries re ON re.race_id = r.id
    WHERE r.track_id = ?
    GROUP BY r.id
    ORDER BY r.race_date DESC
    LIMIT 10
  `).all(trackId) as Array<{ id: number; name: string; race_date: string; status: string; entry_count: number }>;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10 space-y-8">

        {/* Header */}
        <div>
          <Link href="/admin/tracks" className="text-xs text-[var(--muted)] hover:text-white transition-colors">← Tracks</Link>
          <h1 className="mt-2 text-3xl font-bold text-white">{track.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {track.location ?? "Location unknown"} · {track.surface_type} · {track.track_length ? `${track.track_length} mi` : "Length unknown"}
            {track.track_family && <> · <span className="text-amber-400">{track.track_family}</span></>}
          </p>
        </div>

        {/* Intelligence editor (track info + similarities + AI suggest) */}
        <TrackIntelligenceEditor
          track={track}
          similars={similars}
          allTracks={allTracks}
        />

        {/* Recent races */}
        {races.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--muted)]">Recent Races Here</h2>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {races.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/admin/races/${r.id}`} className="font-medium text-white hover:text-[var(--accent)] transition-colors">{r.name}</Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)] text-xs">{r.race_date}</td>
                      <td className="px-4 py-3 text-[var(--muted)] text-xs">{r.entry_count} drivers</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${r.status === "complete" ? "text-green-400" : "text-blue-400"}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
