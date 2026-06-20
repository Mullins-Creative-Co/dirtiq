import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getRace, getRaceEntries } from "@/lib/races";
import { calculateRaceOdds } from "@/lib/odds";
import { getScorecardData, hasPredictions } from "@/lib/predictions";
import { PrintButton } from "./print-button";

const moneyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dateFmt  = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

function PlusMinus({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-gray-400">—</span>;
  if (delta > 0) return <span className="inline-flex items-center justify-center rounded-md bg-green-100 text-green-800 font-bold text-xs px-1.5 py-0.5 min-w-[36px]">+{delta}</span>;
  if (delta < 0) return <span className="inline-flex items-center justify-center rounded-md bg-red-100 text-red-800 font-bold text-xs px-1.5 py-0.5 min-w-[36px]">{delta}</span>;
  return <span className="inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-500 font-bold text-xs px-1.5 py-0.5 min-w-[36px]">—</span>;
}

export default async function ScorecardPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const raceId = parseInt(id, 10);
  if (isNaN(raceId)) notFound();

  const race = getRace(raceId);
  if (!race || race.status !== "complete") notFound();

  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  // Prefer locked predictions (snapshot taken at go-live)
  // Fall back to recalculating odds for races that went live before this feature shipped
  const useLocked = hasPredictions(raceId);
  let scorecard: ReturnType<typeof getScorecardData> | null = null;
  const fallbackModelRankMap = new Map<number, number>();
  let fallbackOdds: ReturnType<typeof calculateRaceOdds> = [];

  if (useLocked) {
    scorecard = plain(getScorecardData(raceId));
  } else {
    fallbackOdds = plain(calculateRaceOdds(raceId, race.track_id));
    fallbackOdds.forEach((o, i) => fallbackModelRankMap.set(o.driverId, i + 1));
  }

  const entries = plain(getRaceEntries(raceId));

  // Official results — sorted by finishing position, DNFs at end
  const results = [...entries]
    .filter((e) => e.finishing_position != null || e.dnf)
    .sort((a, b) => {
      if (a.dnf && !b.dnf) return 1;
      if (!a.dnf && b.dnf) return -1;
      return (a.finishing_position ?? 999) - (b.finishing_position ?? 999);
    });

  // Hard charger
  let hardCharger: typeof results[0] | null = null;
  let hardChargerGain = 0;
  for (const e of results) {
    if (e.dnf || e.starting_position == null || e.finishing_position == null) continue;
    const gain = e.starting_position - e.finishing_position;
    if (gain > hardChargerGain) { hardChargerGain = gain; hardCharger = e; }
  }

  // Build unified scorecard rows
  type ScorecardRow = {
    driverId: number; driverName: string; carNumber: string | null;
    actualPos: number | null; startPos: number | null; plusMinus: number | null;
    lapsLed: number; margin: string | null; money: number | null; dnf: boolean;
    modelRank: number | null; modelOdds: string;
    delta: number | null;
    impliedProb: number | null;
    trackWinRate: number | null; trackStarts: number | null;
    seasonWinRate: number | null; last5AvgFinish: number | null;
    tonightHeatPos: number | null; specialtyBonus: number | null;
  };

  const scorecardRows: ScorecardRow[] = results.map((e) => {
    if (useLocked && scorecard) {
      const sc = scorecard.rows.find((r) => r.driver_id === e.driver_id);
      return {
        driverId: e.driver_id, driverName: e.driver_name, carNumber: e.car_number,
        actualPos: e.dnf ? null : (e.finishing_position ?? null),
        startPos: e.starting_position,
        plusMinus: sc?.plus_minus ?? null,
        lapsLed: e.laps_led, margin: e.margin, money: e.money, dnf: !!e.dnf,
        modelRank: sc?.predicted_rank ?? null,
        modelOdds: sc?.american_odds ?? "—",
        delta: sc?.rank_delta ?? null,
        impliedProb: sc?.implied_probability ?? null,
        trackWinRate: sc?.track_win_rate ?? null,
        trackStarts: sc?.track_starts ?? null,
        seasonWinRate: sc?.season_win_rate ?? null,
        last5AvgFinish: sc?.last5_avg_finish ?? null,
        tonightHeatPos: sc?.tonight_heat_pos ?? null,
        specialtyBonus: sc?.specialty_bonus ?? null,
      };
    } else {
      const o = fallbackOdds.find((x) => x.driverId === e.driver_id);
      const modelRank = fallbackModelRankMap.get(e.driver_id) ?? null;
      const actualPos = e.dnf ? null : (e.finishing_position ?? null);
      const plusMinus = e.starting_position != null && actualPos != null ? e.starting_position - actualPos : null;
      return {
        driverId: e.driver_id, driverName: e.driver_name, carNumber: e.car_number,
        actualPos, startPos: e.starting_position, plusMinus,
        lapsLed: e.laps_led, margin: e.margin, money: e.money, dnf: !!e.dnf,
        modelRank, modelOdds: o?.americanOdds ?? "—",
        delta: modelRank != null && actualPos != null ? modelRank - actualPos : null,
        impliedProb: o?.impliedProbability ?? null,
        trackWinRate: o?.reasoning.trackWinRate ?? null,
        trackStarts: o?.reasoning.trackStarts ?? null,
        seasonWinRate: o?.reasoning.seasonWinRate ?? null,
        last5AvgFinish: o?.reasoning.last5AvgFinish ?? null,
        tonightHeatPos: o?.reasoning.tonightHeatPos ?? null,
        specialtyBonus: o?.reasoning.specialtyBonus ?? null,
      };
    }
  });

  // Summary stats
  const validDeltaRows = scorecardRows.filter((r) => r.delta != null && !r.dnf);
  const mae = validDeltaRows.length > 0
    ? validDeltaRows.reduce((s, r) => s + Math.abs(r.delta!), 0) / validDeltaRows.length
    : null;
  const winner = scorecardRows.find((r) => r.actualPos === 1);
  const winnerModelRank = winner?.modelRank ?? null;

  const spearman = scorecard?.summary.spearman ?? (() => {
    const ranked = scorecardRows.filter((r) => r.actualPos != null && !r.dnf && r.modelRank != null);
    const n = ranked.length;
    if (n < 3) return null;
    const d2 = ranked.reduce((s, r) => s + Math.pow((r.modelRank ?? 0) - (r.actualPos ?? 0), 2), 0);
    return 1 - (6 * d2) / (n * (n * n - 1));
  })();

  const top3actual = new Set(scorecardRows.filter((r) => r.actualPos != null && r.actualPos <= 3 && !r.dnf).map((r) => r.driverId));
  const top3modelIds = scorecardRows.filter((r) => r.modelRank != null && r.modelRank <= 3).map((r) => r.driverId);
  const top3hits = top3modelIds.filter((id) => top3actual.has(id)).length;

  const raceDate = dateFmt.format(new Date(race.race_date + "T12:00:00"));
  const purse = (race as typeof race & { purse_to_win?: number }).purse_to_win;
  const lockedAt = scorecard?.summary.locked_at;
  const hadPrelim = scorecard?.summary.had_prelim_data ?? false;
  const underrated = [...scorecardRows]
    .filter((r) => !r.dnf && r.delta != null && r.delta >= 3)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
    .slice(0, 5);
  const overrated = [...scorecardRows]
    .filter((r) => !r.dnf && r.delta != null && r.delta <= -3)
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))
    .slice(0, 5);
  const learningVerdict =
    winnerModelRank === 1
      ? "Model favorite won. Keep the feature mix stable and only inspect undercard misses."
      : winnerModelRank != null && winnerModelRank <= 3
        ? "Winner was inside the playable group. Review line pricing, not the whole model."
        : winnerModelRank != null && winnerModelRank <= 6
          ? "Winner was close but not protected enough. Look for a repeatable missing signal."
          : "Winner was outside the core model group. Review entries, prelim data, local/similar-track history, and caveats before retraining.";
  const completedResults = results.filter((r) => r.finishing_position != null && !r.dnf);
  const startRows = completedResults.filter((r) => r.starting_position != null);
  const heatRows = completedResults.filter((r) => r.heat_position != null);
  const bmainRows = completedResults.filter((r) => r.bmain_position != null);
  const deepStarterTop10 = completedResults
    .filter((r) => (r.starting_position ?? 0) >= 15 && (r.finishing_position ?? 999) <= 10)
    .sort((a, b) => (a.finishing_position ?? 999) - (b.finishing_position ?? 999));
  const frontRow = completedResults.filter((r) => r.starting_position != null && r.starting_position <= 2);
  const frontRowTop3 = frontRow.filter((r) => (r.finishing_position ?? 999) <= 3);
  const improvementQueue = [
    {
      title: "Lock a pre-feature snapshot",
      status: useLocked ? "Done" : "Needed",
      detail: useLocked
        ? "This scorecard is comparing against the locked go-live odds."
        : "No locked odds snapshot was found, so review uses leakage-protected recalculated odds. Next race, hit go-live before the feature.",
    },
    {
      title: "Complete the feature lineup",
      status: startRows.length >= completedResults.length * 0.9 ? "Done" : "Needed",
      detail: `${startRows.length}/${completedResults.length} finishers have starting spots. Missing starts make pole, front-row, and passing signals weaker.`,
    },
    {
      title: "Capture B-main/provisional paths",
      status: bmainRows.length > 0 ? "Tracked" : "Needed",
      detail: bmainRows.length > 0
        ? `${bmainRows.length} B-main/provisional path rows were captured. Keep feeding this into retraining.`
        : "No B-main rows are structured yet. Add B-main/provisional tags so deep-field downgrades become automatic.",
    },
    {
      title: "Split win picks from props",
      status: top3hits >= 2 ? "High value" : "Review",
      detail: `Model top-3 overlap was ${top3hits}/3. Use top-3/top-5 props when the win favorite is clear but contender order is clustered.`,
    },
    {
      title: "Audit front-row conversion",
      status: frontRow.length > 0 ? "Watch" : "Sparse",
      detail: frontRow.length > 0
        ? `${frontRowTop3.length}/${frontRow.length} front-row starters finished top 3. Keep track-specific pole/front-row weight active.`
        : "No front-row rows found, so starting-position learning is incomplete.",
    },
    {
      title: "Review deep movers",
      status: deepStarterTop10.length > 0 ? "Feature candidate" : "Clean",
      detail: deepStarterTop10.length > 0
        ? `${deepStarterTop10.map((r) => `${r.driver_name} P${r.finishing_position} from ${r.starting_position}`).join(", ")}. Consider passing/track-state features.`
        : "No major deep-starter top-10 exceptions in the final result.",
    },
  ];

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      <div className="print:hidden px-6 pt-4 pb-0 flex items-center justify-between">
        <Link href={`/admin/races/${raceId}`} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">← Back to race</Link>
        <PrintButton />
      </div>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">

        {/* Header */}
        <header className="border-b-2 border-black pb-4">
          <div className="text-3xl font-black tracking-tight text-black leading-none">DIRTIQ</div>
          <div className="text-sm font-semibold text-amber-600 mt-0.5">Post-Race Model Scorecard + Track Analogy Framework</div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{race.division}</span>
            <span>—</span>
            <span>{race.name}</span>
            <span>|</span>
            <span>{race.track_name}</span>
            <span>|</span>
            <span>{raceDate}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-gray-500">
            {race.distance && <span>{race.distance} Laps</span>}
            {purse && <><span>•</span><span>{moneyFmt.format(purse)}-to-Win</span></>}
            {race.track_condition && <><span>•</span><span>{race.track_condition}</span></>}
            {race.time_of_day && <><span>•</span><span className="capitalize">{race.time_of_day} race</span></>}
            {race.temperature_f && <><span>•</span><span>{race.temperature_f}°F</span></>}
            {race.humidity_pct && <><span>•</span><span>{race.humidity_pct}% humidity</span></>}
          </div>
          {lockedAt && (
            <div className="mt-2 text-[10px] text-gray-400">
              Model snapshot locked at go-live · {hadPrelim ? "included heat/QT data" : "pre-qualifying odds"}
              {!useLocked && <span className="ml-2 text-amber-500">⚠ No locked snapshot — showing recalculated odds</span>}
            </div>
          )}
        </header>

        {/* Official Feature Results */}
        <section>
          <h2 className="text-lg font-bold text-black mb-3 tracking-tight">Official Feature Results</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-black text-white">
                  {["POS", "START", "+/−", "DRIVER", "LAPS LED", "MARGIN", "MONEY"].map((h) => (
                    <th key={h} className={`px-3 py-2 font-bold text-xs uppercase tracking-widest whitespace-nowrap ${["LAPS LED"].includes(h) ? "text-center" : h === "DRIVER" ? "text-left" : h === "MONEY" || h === "MARGIN" ? "text-right" : "text-center"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scorecardRows.map((e, i) => {
                  const isWinner = e.actualPos === 1 && !e.dnf;
                  return (
                    <tr key={e.driverId} className={`border-b border-gray-200 ${isWinner ? "bg-amber-50" : i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                      <td className="px-3 py-2 text-center font-bold text-sm">
                        {e.dnf ? <span className="text-red-600 text-xs font-semibold">DNF</span> : e.actualPos}
                      </td>
                      <td className="px-3 py-2 text-center text-gray-500 text-xs tabular-nums">{e.startPos ?? "—"}</td>
                      <td className="px-3 py-2 text-center"><PlusMinus delta={e.plusMinus} /></td>
                      <td className="px-3 py-2 font-semibold text-gray-900">
                        {e.carNumber && <span className="text-gray-400 font-mono text-xs mr-1.5">{e.carNumber}</span>}
                        {e.driverName}
                        {isWinner && <span className="ml-2 text-[10px] font-bold text-amber-600 uppercase tracking-wide">Winner</span>}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-gray-700">
                        {e.lapsLed > 0 ? e.lapsLed : <span className="text-gray-300">0</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 text-xs">
                        {isWinner ? <span className="font-semibold text-gray-900">Winner</span> : (e.margin ?? <span className="text-gray-300">—</span>)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">
                        {e.money != null ? moneyFmt.format(e.money) : <span className="text-gray-300 font-normal">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hardCharger && hardChargerGain > 0 && (
            <div className="mt-3 text-xs text-gray-600">
              <span className="font-bold text-gray-900">FOX Factory Hard Charger:</span>{" "}
              {hardCharger.driver_name} (+{hardChargerGain} positions, started {hardCharger.starting_position}, finished {hardCharger.finishing_position})
            </div>
          )}
        </section>

        {/* Pre-Race Model vs Actual */}
        <section>
          <h2 className="text-lg font-bold text-black mb-1 tracking-tight">Pre-Race Model vs. Actual — Scorecard</h2>
          <p className="text-xs text-gray-500 mb-3">
            dirtIQ model rank computed before results were entered.
            {mae != null && ` Mean position error: ${mae.toFixed(1)} spots.`}
            {winnerModelRank != null && ` Winner was model's #${winnerModelRank} pick.`}
          </p>

          {/* Summary chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {winnerModelRank != null && (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${winnerModelRank === 1 ? "bg-green-100 text-green-800" : winnerModelRank <= 3 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                Winner: Model #{winnerModelRank}{winnerModelRank === 1 ? " ✓" : ""}
              </span>
            )}
            {spearman != null && (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${spearman >= 0.5 ? "bg-green-100 text-green-800" : spearman >= 0.2 ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"}`}>
                Spearman ρ = {spearman.toFixed(2)}
              </span>
            )}
            {mae != null && (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${mae <= 3 ? "bg-green-100 text-green-800" : mae <= 5 ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-700"}`}>
                Avg error: {mae.toFixed(1)} pos
              </span>
            )}
            <span className={`rounded-full px-3 py-1 text-xs font-semibold bg-gray-100 text-gray-600`}>
              Top-3 hit: {top3hits}/3
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-black">
                  {["Model Rank", "Driver", "Pre-Race Odds", "Win%", "Actual", "Delta", "Key Factors"].map((h) => (
                    <th key={h} className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 ${h === "Driver" || h === "Key Factors" ? "text-left" : "text-center"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...scorecardRows]
                  .sort((a, b) => (a.modelRank ?? 999) - (b.modelRank ?? 999))
                  .map((e, i) => {
                    const deltaColor = e.delta == null ? "text-gray-300"
                      : e.delta > 0 ? "text-green-700 font-semibold"
                      : e.delta < 0 ? "text-red-600 font-semibold"
                      : "text-gray-500";
                    const factors: string[] = [];
                    if (e.trackWinRate != null && e.trackStarts != null && e.trackStarts >= 1)
                      factors.push(`${Math.round(e.trackWinRate * 100)}% track WR (${e.trackStarts})`);
                    if (e.seasonWinRate != null && e.seasonWinRate > 0)
                      factors.push(`${Math.round(e.seasonWinRate * 100)}% season`);
                    if (e.last5AvgFinish != null)
                      factors.push(`L5 avg P${e.last5AvgFinish.toFixed(1)}`);
                    if (e.tonightHeatPos != null)
                      factors.push(`Heat P${e.tonightHeatPos}`);
                    if (e.specialtyBonus && e.specialtyBonus > 0)
                      factors.push(`+${Math.round(e.specialtyBonus * 100)}pt specialist`);
                    return (
                      <tr key={e.driverId} className={`border-b border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${e.modelRank === 1 ? "bg-amber-400 text-white" : e.modelRank != null && e.modelRank <= 3 ? "bg-gray-200 text-gray-700" : "bg-gray-100 text-gray-500"}`}>
                            {e.modelRank ?? "?"}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-900">{e.driverName}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-xs font-mono text-gray-600">{e.modelOdds}</td>
                        <td className="px-3 py-2 text-center text-xs text-gray-500 tabular-nums">
                          {e.impliedProb != null ? `${Math.round(e.impliedProb * 100)}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {e.dnf
                            ? <span className="text-red-500 text-xs font-semibold">DNF</span>
                            : e.actualPos != null
                              ? <span className={`font-semibold ${e.actualPos === 1 ? "text-amber-600" : e.actualPos <= 3 ? "text-green-700" : "text-gray-700"}`}>P{e.actualPos}</span>
                              : <span className="text-gray-300">—</span>}
                        </td>
                        <td className={`px-3 py-2 text-center text-xs tabular-nums ${deltaColor}`}>
                          {e.delta == null ? "—"
                            : e.delta > 0 ? `+${e.delta}`
                            : e.delta < 0 ? `${e.delta}`
                            : "="}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {factors.length > 0 ? factors.join(" · ") : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-gray-400">
            Delta: positive = finished better than model predicted · negative = worse · Spearman ρ measures full-field rank correlation (1.0 = perfect)
          </p>
        </section>

        {/* Post-Race Learning Review */}
        <section className="border-t border-gray-200 pt-6">
          <h2 className="text-lg font-bold text-black mb-1 tracking-tight">Post-Race Learning Review</h2>
          <p className="text-xs text-gray-500 mb-4">
            Use this before adding features. Caveats explain one race; features require repeatable patterns across many races.
          </p>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-4">
            <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Underwriter read</div>
            <p className="text-sm font-semibold text-gray-900">{learningVerdict}</p>
            <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
              <div>
                <span className="font-bold text-gray-900">Model baseline:</span>{" "}
                {winnerModelRank != null ? `winner ranked #${winnerModelRank}` : "no winner rank"}
              </div>
              <div>
                <span className="font-bold text-gray-900">Review mode:</span>{" "}
                {useLocked ? "locked pre-race snapshot" : "recalculated fallback"}
              </div>
              <div>
                <span className="font-bold text-gray-900">Race-night data:</span>{" "}
                {hadPrelim ? "included prelim inputs" : "missing heat/QT snapshot"}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Model Underrated</div>
              {underrated.length === 0 ? (
                <p className="text-sm text-gray-400">No major positive misses.</p>
              ) : (
                <div className="space-y-2">
                  {underrated.map((r) => (
                    <div key={r.driverId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-gray-900">{r.driverName}</span>
                      <span className="text-xs font-semibold text-green-700">
                        Model #{r.modelRank} · P{r.actualPos} · +{r.delta}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[10px] leading-4 text-gray-400">
                If the same kind of driver repeats here, convert the reason into a structured feature.
              </p>
            </div>

            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Model Overrated</div>
              {overrated.length === 0 ? (
                <p className="text-sm text-gray-400">No major negative misses.</p>
              ) : (
                <div className="space-y-2">
                  {overrated.map((r) => (
                    <div key={r.driverId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-gray-900">{r.driverName}</span>
                      <span className="text-xs font-semibold text-red-600">
                        Model #{r.modelRank} · P{r.actualPos ?? "DNF"} · {r.delta}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[10px] leading-4 text-gray-400">
                Check whether the miss came from entry status, poor prelim data, DNF risk, or over-weighted history.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Next Iteration Steps</div>
            <ol className="grid gap-2 text-xs leading-5 text-gray-600 sm:grid-cols-4">
              <li><span className="font-bold text-gray-900">1.</span> Save race notes for any obvious caveat.</li>
              <li><span className="font-bold text-gray-900">2.</span> Add missing structured data, not just text.</li>
              <li><span className="font-bold text-gray-900">3.</span> Retrain after the result is complete.</li>
              <li><span className="font-bold text-gray-900">4.</span> Run XG audit and keep only proven signal.</li>
            </ol>
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Improvement Queue</div>
            <div className="grid gap-2">
              {improvementQueue.map((item) => (
                <div key={item.title} className="grid gap-2 border border-gray-100 bg-white px-3 py-3 sm:grid-cols-[140px_1fr]">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{item.status}</p>
                    <p className="mt-1 text-sm font-bold text-gray-900">{item.title}</p>
                  </div>
                  <p className="text-xs leading-5 text-gray-600">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Model Performance Summary */}
        <section className="border-t border-gray-200 pt-6">
          <h2 className="text-lg font-bold text-black mb-4 tracking-tight">Model Performance Summary</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Top Picks vs. Actual</div>
              <div className="space-y-2">
                {[...scorecardRows]
                  .filter((r) => r.modelRank != null && r.modelRank <= 5)
                  .sort((a, b) => (a.modelRank ?? 0) - (b.modelRank ?? 0))
                  .map((r) => (
                    <div key={r.driverId} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-5 text-right">#{r.modelRank}</span>
                        <span className="font-medium text-gray-900">{r.driverName}</span>
                        <span className="text-[10px] font-mono text-gray-400">{r.modelOdds}</span>
                      </div>
                      {r.dnf
                        ? <span className="text-red-500 text-xs">DNF</span>
                        : r.actualPos != null
                          ? <span className={`text-xs font-semibold ${r.actualPos === 1 ? "text-amber-600" : r.actualPos <= 3 ? "text-green-700" : r.delta != null && r.delta > 0 ? "text-green-600" : "text-red-500"}`}>
                              P{r.actualPos} {r.delta != null && r.delta > 0 ? "↑" : r.delta != null && r.delta < 0 ? "↓" : "="}
                            </span>
                          : <span className="text-gray-300 text-xs">—</span>}
                    </div>
                  ))}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Model Stats</div>
              <div className="space-y-3">
                {[
                  { label: "Winner pick", value: winnerModelRank != null ? `#${winnerModelRank} — ${winnerModelRank === 1 ? "Nailed it" : winnerModelRank <= 3 ? "Top 3" : winnerModelRank <= 5 ? "Top 5" : "Missed"}` : "—", ok: winnerModelRank != null && winnerModelRank <= 3 ? true : winnerModelRank != null ? false : null },
                  { label: "Spearman rank correlation", value: spearman != null ? spearman.toFixed(3) : "—", ok: spearman != null ? spearman >= 0.4 : null },
                  { label: "Avg position error", value: mae != null ? `${mae.toFixed(1)} spots` : "—", ok: mae != null ? mae <= 4 : null },
                  { label: "Top-3 hit rate", value: `${top3hits}/3 (${Math.round((top3hits / 3) * 100)}%)`, ok: top3hits >= 2 },
                  { label: "Outperformers (beat model 3+)", value: `${scorecardRows.filter((r) => r.delta != null && r.delta >= 3).length} drivers`, ok: null },
                  { label: "Underperformers (missed 3+)", value: `${scorecardRows.filter((r) => r.delta != null && r.delta <= -3).length} drivers`, ok: null },
                ].map((stat) => (
                  <div key={stat.label} className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">{stat.label}</span>
                    <span className={`font-semibold ${stat.ok === true ? "text-green-700" : stat.ok === false ? "text-red-600" : "text-gray-700"}`}>
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <footer className="border-t border-gray-200 pt-4 text-[10px] text-gray-400 flex items-center justify-between">
          <span>Generated by dirtIQ · {race.name} · {raceDate}</span>
          <span>Model: Elo + composite score blend · 12% vig{useLocked ? " · locked snapshot" : " · recalculated"}</span>
        </footer>
      </main>

      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
