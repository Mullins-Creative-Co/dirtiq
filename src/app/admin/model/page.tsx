import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { computeFactorAccuracy, computeConditionBreakdown, getDriverFactorTable } from "@/lib/analytics";
import { calculateRaceOdds } from "@/lib/odds";
import { listRaces, getRace } from "@/lib/races";
import { RaceOddsBreakdown } from "@/components/race-odds-breakdown";
import { RacePicker } from "@/components/race-picker";

function pct(n: number | null, decimals = 0) {
  if (n === null) return "—";
  return `${(n * 100).toFixed(decimals)}%`;
}

function AccuracyBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-slate-600 italic">need data</span>;
  const w = Math.round(value * 100);
  const color = value >= 0.6 ? "bg-green-500" : value >= 0.4 ? "bg-amber-500" : "bg-slate-600";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded-full bg-slate-800 shrink-0">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className={`text-xs tabular-nums font-semibold ${value >= 0.6 ? "text-green-400" : value >= 0.4 ? "text-amber-400" : "text-slate-500"}`}>
        {pct(value)}
      </span>
    </div>
  );
}

function WeightBar({ weight }: { weight: string }) {
  const num = parseFloat(weight.replace(/[^0-9.]/g, ""));
  const isNeg = weight.startsWith("−") || weight.startsWith("-");
  const w = Math.min(100, (num / 30) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-slate-800 shrink-0">
        <div className={`h-1.5 rounded-full ${isNeg ? "bg-red-500/70" : "bg-amber-500"}`} style={{ width: `${w}%` }} />
      </div>
      <span className={`text-xs font-mono font-semibold tabular-nums ${isNeg ? "text-red-400" : "text-amber-400"}`}>{weight}</span>
    </div>
  );
}

export default async function ModelPage({
  searchParams,
}: {
  searchParams: Promise<{ race?: string }>;
}) {
  await connection();
  const { race: raceParam } = await searchParams;

  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const allRaces = plain(listRaces());
  const selectedRaceId = raceParam ? parseInt(raceParam, 10) : null;
  const selectedRace = selectedRaceId ? getRace(selectedRaceId) : null;

  let odds: ReturnType<typeof calculateRaceOdds> = [];
  if (selectedRace) {
    try {
      odds = plain(calculateRaceOdds(selectedRace.id, selectedRace.track_id));
    } catch {}
  }

  const factorAccuracy = computeFactorAccuracy();
  const conditions = computeConditionBreakdown();
  const driverTable = getDriverFactorTable();

  // Default to most recent upcoming race if none selected
  const defaultRace = allRaces.find((r) => r.status === "upcoming") ?? allRaces[0] ?? null;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-10 space-y-10">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-white">Odds Intelligence</h1>
            <p className="mt-1 text-sm text-[var(--muted)] max-w-2xl">
              Select a race to see the full breakdown — every scoring factor, its weight, and exactly why each driver is priced the way they are.
            </p>
          </div>
          {defaultRace && !selectedRaceId && (
            <Link
              href={`/admin/model?race=${defaultRace.id}`}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-black hover:opacity-90 transition-opacity"
            >
              View {defaultRace.name} →
            </Link>
          )}
        </div>

        {/* Race picker */}
        <RacePicker races={allRaces} selectedId={selectedRaceId} />

        {/* Odds breakdown for selected race */}
        {selectedRace ? (
          <section className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">{selectedRace.name}</h2>
                <p className="text-sm text-[var(--muted)] mt-0.5">
                  {selectedRace.track_name} · {selectedRace.race_date} · {selectedRace.track_condition} · {odds.length} drivers
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Link href={`/admin/races/${selectedRace.id}`}
                  className="text-xs border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--muted)] hover:text-white transition-colors">
                  Race page →
                </Link>
                <Link href={`/race/${selectedRace.id}`}
                  className="text-xs border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--muted)] hover:text-white transition-colors">
                  Bet page →
                </Link>
              </div>
            </div>

            {odds.length === 0 ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
                <p className="text-[var(--muted)] text-sm">No drivers entered for this race yet.</p>
                <Link href={`/admin/races/${selectedRace.id}`} className="mt-2 inline-block text-xs text-[var(--accent)] hover:underline">
                  Add drivers to the race →
                </Link>
              </div>
            ) : (
              <RaceOddsBreakdown odds={odds} fieldSize={odds.length} />
            )}
          </section>
        ) : (
          /* Landing state — no race selected */
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center space-y-3">
            <p className="text-white font-semibold">Select a race above to see the full odds breakdown</p>
            <p className="text-sm text-[var(--muted)] max-w-md mx-auto">
              Each driver card shows all 16 scoring factors — track history, season form, tonight's heat results, driver specialties, and the Elo blend — with their exact contribution to the final odds.
            </p>
            {defaultRace && (
              <Link href={`/admin/model?race=${defaultRace.id}`}
                className="inline-block rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-black hover:opacity-90 transition-opacity">
                View {defaultRace.name}
              </Link>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-[var(--border)] pt-2">
          <p className="text-xs uppercase tracking-widest text-slate-600 font-semibold">Model Calibration</p>
        </div>

        {/* How the model works */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
          <h2 className="text-base font-semibold text-white">Scoring Architecture</h2>
          <div className="grid sm:grid-cols-2 gap-4 text-sm text-[var(--muted)]">
            <div className="space-y-2">
              <p>16 factors are weighted into a <strong className="text-white">composite score</strong> (track/season/prelim stats). This blends with an <strong className="text-white">Elo rating</strong> at 45/55 normally, shifting to 30/70 once heat data is entered for ≥25% of the field.</p>
              <p>Driver <strong className="text-amber-400">specialties</strong> (set via Drivers page or AI Suggest) add a flat bonus before the Elo blend — useful for regional specialists where historical data is sparse.</p>
            </div>
            <div className="space-y-2">
              <p>Track <strong className="text-amber-400">similarity weights</strong> (set via Tracks page or AI Suggest) make this track's historical results count at other similar tracks — bidirectional.</p>
              <p>A <strong className="text-white">12% vig</strong> is applied to raw win probabilities to produce American odds. Prop bets (top-3, H2H, DNF) de-vig the win probs first before applying their own vig.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1 text-xs">
            <span className="rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 px-3 py-1">55% Composite</span>
            <span className="rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 px-3 py-1">45% Elo</span>
            <span className="rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 px-3 py-1 font-semibold">→ 70% Composite when heat data set</span>
            <span className="rounded-full bg-slate-700/50 border border-slate-600 text-slate-300 px-3 py-1">12% vig</span>
          </div>
        </section>

        {/* Factor weights + accuracy */}
        <section>
          <h2 className="text-base font-semibold text-white mb-4">
            Factor Weights &amp; Historical Accuracy
            <span className="ml-2 text-xs font-normal text-[var(--muted)]">how often does the #1 driver on each factor actually win?</span>
          </h2>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                  {["Factor", "Weight", "What it measures", "Races", "Accuracy"].map((h) => (
                    <th key={h} className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${h === "Factor" || h === "What it measures" ? "text-left" : "text-center"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {factorAccuracy.map((f) => (
                  <tr key={f.factor} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                    <td className="px-4 py-3 font-medium text-white whitespace-nowrap">{f.factor}</td>
                    <td className="px-4 py-3"><WeightBar weight={f.weight} /></td>
                    <td className="px-4 py-3 text-[var(--muted)] text-xs max-w-xs">{f.description}</td>
                    <td className="px-4 py-3 text-center text-[var(--muted)] text-xs tabular-nums">
                      {f.racesWithData > 0 ? `${f.timesTopPickWon}/${f.racesWithData}` : "—"}
                    </td>
                    <td className="px-4 py-3"><div className="flex justify-center"><AccuracyBar value={f.accuracy} /></div></td>
                  </tr>
                ))}
                <tr className="border-b border-[var(--border)] bg-blue-500/5">
                  <td className="px-4 py-3 font-medium text-blue-300">Elo Rating</td>
                  <td className="px-4 py-3"><WeightBar weight="45% blend" /></td>
                  <td className="px-4 py-3 text-[var(--muted)] text-xs">DLM-seeded, updated pairwise after every result</td>
                  <td className="px-4 py-3 text-center text-[var(--muted)] text-xs">all races</td>
                  <td className="px-4 py-3"><div className="flex justify-center"><span className="text-xs text-blue-400">blended signal</span></div></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Condition breakdown */}
        {conditions.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-white mb-4">Winners by Track Condition</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {conditions.map((c) => (
                <div key={c.condition} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-amber-400">{c.condition}</span>
                    <span className="text-xs text-[var(--muted)]">{c.races} race{c.races !== 1 ? "s" : ""}</span>
                  </div>
                  {c.topDrivers.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">No wins recorded.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {c.topDrivers.map((d) => (
                        <div key={d.name} className="flex items-center justify-between text-sm">
                          <span className="text-white">{d.name}</span>
                          <div className="flex items-center gap-2 text-xs text-[var(--muted)] tabular-nums">
                            <span className="text-amber-400 font-semibold">{d.wins}W</span>
                            <span>/ {d.starts}</span>
                            <span className="text-slate-600">({Math.round((d.wins / d.starts) * 100)}%)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Driver factor table */}
        {driverTable.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">
                Driver Season Stats
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">feeds the model — import more via <Link href="/admin/import" className="text-[var(--accent)] hover:underline">WoO Import</Link></span>
              </h2>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                    {["Driver", "Starts", "Wins", "Win%", "Avg Fin", "Last 5", "QT%", "Heat W%", "DNF%"].map((h) => (
                      <th key={h} className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${h === "Driver" ? "text-left" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {driverTable
                    .sort((a, b) => (b.seasonWins / Math.max(b.seasonStarts, 1)) - (a.seasonWins / Math.max(a.seasonStarts, 1)))
                    .map((d) => {
                      const winRate = d.seasonStarts > 0 ? d.seasonWins / d.seasonStarts : 0;
                      return (
                        <tr key={d.name} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                          <td className="px-3 py-2.5 font-medium text-white">
                            <Link href={`/admin/drivers/${d.driverId ?? "#"}`} className="hover:text-[var(--accent)] transition-colors">{d.name}</Link>
                          </td>
                          <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums">{d.seasonStarts}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            <span className={d.seasonWins > 0 ? "text-amber-400 font-semibold" : "text-[var(--muted)]"}>{d.seasonWins}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            <span className={winRate >= 0.2 ? "text-green-400" : winRate >= 0.1 ? "text-amber-400" : "text-[var(--muted)]"}>
                              {pct(d.seasonStarts > 0 ? winRate : null)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            <span className={d.avgFinish != null && d.avgFinish <= 5 ? "text-green-400" : d.avgFinish != null && d.avgFinish <= 9 ? "text-amber-400" : "text-[var(--muted)]"}>
                              {d.avgFinish != null ? d.avgFinish.toFixed(1) : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            <span className={d.last5Avg != null && d.last5Avg <= 4.5 ? "text-green-400 font-semibold" : d.last5Avg != null && d.last5Avg <= 9 ? "text-amber-400" : "text-[var(--muted)]"}>
                              {d.last5Avg != null ? d.last5Avg.toFixed(1) : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">{pct(d.qtRate)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">{pct(d.heatWinRate)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums text-xs ${d.dnfRate != null && d.dnfRate > 0.12 ? "text-red-400" : "text-[var(--muted)]"}`}>
                            {pct(d.dnfRate)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>
        )}

      </main>
    </div>
  );
}
