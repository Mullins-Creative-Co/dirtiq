import type { PredictionCard, PredictionCardRow } from "@/lib/prediction-card";

type ConsensusRow = PredictionCardRow & {
  modelOnlyProbability: number;
  researchProbability: number;
  underwriterProbability: number;
  modelRank: number;
  researchRank: number;
  underwriterRank: number;
  disagreement: "Low" | "Medium" | "High";
  researchSignal: string;
};

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function americanOdds(probability: number) {
  if (probability >= 1) return "-∞";
  if (probability <= 0) return "+∞";

  const odds =
    probability >= 0.5
      ? -(probability / (1 - probability)) * 100
      : ((1 - probability) / probability) * 100;

  return odds < 0 ? Math.round(odds).toString() : `+${Math.round(odds)}`;
}

function disagreementClass(value: ConsensusRow["disagreement"]) {
  if (value === "High") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (value === "Medium") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-green-500/30 bg-green-500/10 text-green-300";
}

function watchToneClass(tone: "up" | "down" | "review") {
  if (tone === "up") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (tone === "down") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

function clampProbability(value: number) {
  return Math.max(0.001, Math.min(0.85, value));
}

function buildConsensusRows(card: PredictionCard): ConsensusRow[] {
  const withSignals = card.rows.map((row) => {
    const modelOnlyProbability = row.mlProbability ?? row.blendedProbability;
    const researchDelta = row.modelProbability - modelOnlyProbability;
    const researchProbability = clampProbability(modelOnlyProbability + researchDelta);
    const underwriterProbability = clampProbability(
      modelOnlyProbability * 0.75 + researchProbability * 0.25
    );
    const researchSignal =
      row.warnings[0] ??
      row.reasons.find((reason) => !reason.startsWith("ML layer")) ??
      "No active caveat or context signal.";

    return {
      ...row,
      modelOnlyProbability,
      researchProbability,
      underwriterProbability,
      modelRank: 0,
      researchRank: 0,
      underwriterRank: 0,
      disagreement: "Low" as const,
      researchSignal,
    };
  });

  const modelRanks = new Map(
    [...withSignals]
      .sort((a, b) => b.modelOnlyProbability - a.modelOnlyProbability)
      .map((row, index) => [row.driverId, index + 1])
  );
  const researchRanks = new Map(
    [...withSignals]
      .sort((a, b) => b.researchProbability - a.researchProbability)
      .map((row, index) => [row.driverId, index + 1])
  );

  return withSignals
    .map((row) => {
      const modelRank = modelRanks.get(row.driverId) ?? row.rank;
      const researchRank = researchRanks.get(row.driverId) ?? row.rank;
      const rankGap = Math.abs(modelRank - researchRank);
      const probabilityGap = Math.abs(row.researchProbability - row.modelOnlyProbability);
      const disagreement: ConsensusRow["disagreement"] =
        rankGap >= 5 || probabilityGap >= 0.06
          ? "High"
          : rankGap >= 3 || probabilityGap >= 0.03
            ? "Medium"
            : "Low";

      return { ...row, modelRank, researchRank, disagreement };
    })
    .sort((a, b) => b.underwriterProbability - a.underwriterProbability)
    .map((row, index) => ({ ...row, underwriterRank: index + 1 }));
}

export function AgentConsensusPanel({ card }: { card: PredictionCard }) {
  const allRows = buildConsensusRows(card);
  const rows = allRows.slice(0, 8);
  const top = rows[0];
  const highDisagreement = allRows.filter((row) => row.disagreement === "High").length;
  const movedUp = allRows
    .map((row) => ({ ...row, rankMove: row.modelRank - row.underwriterRank }))
    .filter((row) => row.rankMove >= 3)
    .sort((a, b) => b.rankMove - a.rankMove)
    .slice(0, 4);
  const movedDown = allRows
    .map((row) => ({ ...row, rankMove: row.underwriterRank - row.modelRank }))
    .filter((row) => row.rankMove >= 3)
    .sort((a, b) => b.rankMove - a.rankMove)
    .slice(0, 4);
  const reviewRows = allRows
    .filter((row) => row.disagreement === "High")
    .sort((a, b) => Math.abs(b.researchProbability - b.modelOnlyProbability) - Math.abs(a.researchProbability - a.modelOnlyProbability))
    .slice(0, 4);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
            Agent Consensus
          </p>
          <h2 className="mt-1 text-base font-bold text-white">Model + Research + Underwriter</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Three accountable views from the same Dirt IQ data. High disagreement means review before publishing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
            Top call: {top?.driverName ?? "—"}
          </span>
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${highDisagreement > 0 ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-green-500/30 bg-green-500/10 text-green-300"}`}>
            {highDisagreement} high-disagreement
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
              {["Pick", "Driver", "Model Agent", "Research Agent", "Underwriter", "Suggested", "Disagree", "Why"].map((heading) => (
                <th
                  key={heading}
                  className={`px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] ${
                    ["Driver", "Why"].includes(heading) ? "text-left" : "text-right"
                  }`}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.driverId} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)]">
                <td className="px-4 py-3 text-right font-mono text-xs text-[var(--muted)]">
                  #{row.underwriterRank}
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-white">{row.driverName}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                    Model #{row.modelRank} · Research #{row.researchRank}
                  </p>
                </td>
                <td className="px-4 py-3 text-right">
                  <p className="font-mono text-xs font-bold text-green-300">{pct(row.modelOnlyProbability)}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--muted)]">{row.mlAlgorithm ?? row.mlModel ?? "score"}</p>
                </td>
                <td className="px-4 py-3 text-right">
                  <p className="font-mono text-xs font-bold text-blue-300">{pct(row.researchProbability)}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                    {row.researchProbability >= row.modelOnlyProbability ? "+" : ""}
                    {pct(row.researchProbability - row.modelOnlyProbability)}
                  </p>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs font-bold text-white">
                  {pct(row.underwriterProbability)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs font-bold text-amber-300">
                  {americanOdds(row.underwriterProbability)}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${disagreementClass(row.disagreement)}`}>
                    {row.disagreement}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs leading-5 text-[var(--muted)]">
                  {row.researchSignal}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--surface-raised)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white">Agent Watchlist</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              This does not override XGBoost. Use it to inspect contender props, caveats, and drivers the agent layer says not to ignore.
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
            Review before line changes
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <WatchColumn
            title="Agent Moved Up"
            tone="up"
            empty="No major agent upgrades."
            rows={movedUp.map((row) => ({
              id: row.driverId,
              driver: row.driverName,
              metric: `XG #${row.modelRank} → UW #${row.underwriterRank}`,
              detail: row.researchSignal,
            }))}
          />
          <WatchColumn
            title="Agent Faded"
            tone="down"
            empty="No major agent fades."
            rows={movedDown.map((row) => ({
              id: row.driverId,
              driver: row.driverName,
              metric: `XG #${row.modelRank} → UW #${row.underwriterRank}`,
              detail: row.researchSignal,
            }))}
          />
          <WatchColumn
            title="High Disagreement"
            tone="review"
            empty="No high-disagreement drivers."
            rows={reviewRows.map((row) => ({
              id: row.driverId,
              driver: row.driverName,
              metric: `${pct(row.modelOnlyProbability)} vs ${pct(row.researchProbability)}`,
              detail: row.researchSignal,
            }))}
          />
        </div>
      </div>
    </section>
  );
}

function WatchColumn({
  title,
  tone,
  empty,
  rows,
}: {
  title: string;
  tone: "up" | "down" | "review";
  empty: string;
  rows: Array<{ id: number; driver: string; metric: string; detail: string }>;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">{title}</h4>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${watchToneClass(tone)}`}>
          {rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{empty}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="border-t border-[var(--border)] pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-white">{row.driver}</p>
                <span className="shrink-0 font-mono text-[10px] font-bold text-amber-300">{row.metric}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{row.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
