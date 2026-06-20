"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveMarketLineAction } from "@/app/actions";
import type { PredictionCard } from "@/lib/prediction-card";

type MarketPredictionCardProps = {
  card: PredictionCard;
  initialMarketOdds: Record<number, string>;
  marketLineDetails: Record<
    number,
    { marketOdds: string; source: string; rationale: string | null; updatedAt: string }
  >;
};

type MarketOddsState = Record<string, string>;
type SaveState = Record<string, "saved" | "saving" | "error">;

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function parseAmericanOdds(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const odds = Number(trimmed.replace(/^\+/, ""));
  if (!Number.isFinite(odds) || odds === 0) return null;

  return odds;
}

function americanToDecimal(odds: number) {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}

function americanToImplied(odds: number) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function evPerDollar(modelProbability: number, odds: number) {
  const decimal = americanToDecimal(odds);
  return modelProbability * (decimal - 1) - (1 - modelProbability);
}

function marketRecommendation(
  modelProbability: number,
  marketOdds: number | null,
  fallback: "Play" | "Lean" | "Pass"
) {
  if (marketOdds === null) return fallback;

  const marketEdge = modelProbability - americanToImplied(marketOdds);
  const ev = evPerDollar(modelProbability, marketOdds);

  if (marketEdge >= 0.04 && ev >= 0.08) return "Play";
  if (marketEdge >= 0.02 && ev > 0) return "Lean";
  return "Pass";
}

function badgeClass(value: "Play" | "Lean" | "Pass") {
  if (value === "Play") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (value === "Lean") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-slate-600 bg-slate-800/60 text-slate-400";
}

function confidenceClass(value: "High" | "Medium" | "Low") {
  if (value === "High") return "text-green-300";
  if (value === "Medium") return "text-amber-300";
  return "text-slate-500";
}

function entryStatusClass(value: "confirmed" | "expected" | "unconfirmed" | "scratched") {
  if (value === "confirmed") return "text-green-300";
  if (value === "unconfirmed") return "text-amber-300";
  if (value === "scratched") return "text-red-300";
  return "text-slate-400";
}

export function MarketPredictionCard({
  card,
  initialMarketOdds,
  marketLineDetails,
}: MarketPredictionCardProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [marketOdds, setMarketOdds] = useState<MarketOddsState>(() =>
    Object.fromEntries(
      Object.entries(initialMarketOdds).map(([driverId, odds]) => [driverId, odds])
    )
  );
  const [saveState, setSaveState] = useState<SaveState>({});

  function updateMarketOdds(driverId: number, value: string) {
    setMarketOdds((current) => ({ ...current, [driverId]: value }));
    setSaveState((current) => ({ ...current, [driverId]: "saving" }));
  }

  function saveMarketOdds(driverId: number) {
    const marketValue = marketOdds[driverId] ?? "";

    startTransition(async () => {
      const result = await saveMarketLineAction({
        race_id: card.raceId,
        driver_id: driverId,
        market_odds: marketValue,
      });

      if (result.error) {
        setSaveState((current) => ({ ...current, [driverId]: "error" }));
        return;
      }

      setSaveState((current) => ({ ...current, [driverId]: "saved" }));
      router.refresh();
    });
  }

  const rows = card.rows.map((row) => {
    const marketValue = marketOdds[row.driverId] ?? "";
    const parsedMarketOdds = parseAmericanOdds(marketValue);
    const marketImplied = parsedMarketOdds === null ? null : americanToImplied(parsedMarketOdds);
    const marketEdge = marketImplied === null ? null : row.modelProbability - marketImplied;
    const ev = parsedMarketOdds === null ? null : evPerDollar(row.modelProbability, parsedMarketOdds);
    const recommendation = marketRecommendation(
      row.modelProbability,
      parsedMarketOdds,
      row.recommendation
    );

    return {
      ...row,
      marketValue,
      marketImplied,
      marketEdge,
      ev,
      recommendation,
    };
  });

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-base font-bold text-white">Likely Bets & Market Lines</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Enter market odds to calculate implied probability, model edge, and expected value.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1320px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
              {[
                "Rank",
                "Driver",
                "Entry",
                "#",
                "Profile",
                "Final",
                "ML",
                "Blend",
                "Fair Odds",
                "Market",
                "Market Imp.",
                "Edge",
                "EV/$",
                "Confidence",
                "Rec",
                "Notes",
              ].map((heading) => (
                <th
                  key={heading}
                  className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${
                    ["Driver", "Entry", "Notes"].includes(heading) ? "text-left" : "text-right"
                  }`}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.driverId}
                className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors"
              >
                <td className="px-4 py-3 text-right text-xs tabular-nums text-[var(--muted)]">
                  {row.rank}
                </td>
                <td className="px-4 py-3 font-semibold text-white">{row.driverName}</td>
                <td className={`px-4 py-3 text-xs font-bold uppercase ${entryStatusClass(row.entryStatus)}`}>
                  {row.entryStatus}
                </td>
                <td className="px-4 py-3 text-right text-xs text-[var(--muted)]">{row.carNumber ?? "—"}</td>
                <td className="px-4 py-3 text-right text-xs font-semibold text-blue-300">{row.metricSeries}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-white">{pct(row.modelProbability)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-green-300">
                  {row.mlProbability === null ? "—" : pct(row.mlProbability)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-[var(--muted)]">{pct(row.blendedProbability)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-amber-300">{row.fairOdds}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col items-end gap-1">
                    <input
                      value={row.marketValue}
                      onChange={(event) => updateMarketOdds(row.driverId, event.target.value)}
                      onBlur={() => saveMarketOdds(row.driverId)}
                      inputMode="numeric"
                      placeholder="+450"
                      className="w-20 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-right font-mono text-xs text-white outline-none transition-colors placeholder:text-slate-600 focus:border-[var(--accent)]"
                      aria-label={`${row.driverName} market odds`}
                    />
                    {saveState[row.driverId] ? (
                      <span
                        className={`text-[9px] font-semibold uppercase ${
                          saveState[row.driverId] === "error"
                            ? "text-red-300"
                            : saveState[row.driverId] === "saving"
                              ? "text-amber-300"
                              : "text-green-300"
                        }`}
                      >
                        {saveState[row.driverId]}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-[var(--muted)]">
                  {row.marketImplied === null ? "—" : pct(row.marketImplied)}
                </td>
                <td
                  className={`px-4 py-3 text-right font-mono text-xs ${
                    row.marketEdge === null
                      ? "text-slate-600"
                      : row.marketEdge > 0
                        ? "text-green-300"
                        : "text-red-300"
                  }`}
                >
                  {row.marketEdge === null ? "—" : `${row.marketEdge >= 0 ? "+" : ""}${pct(row.marketEdge)}`}
                </td>
                <td
                  className={`px-4 py-3 text-right font-mono text-xs ${
                    row.ev === null
                      ? "text-slate-600"
                      : row.ev > 0
                        ? "text-green-300"
                        : "text-red-300"
                  }`}
                >
                  {row.ev === null ? "—" : `${row.ev >= 0 ? "+" : ""}${row.ev.toFixed(2)}`}
                </td>
                <td className={`px-4 py-3 text-right text-xs font-bold ${confidenceClass(row.confidence)}`}>
                  {row.confidence}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${badgeClass(row.recommendation)}`}>
                    {row.recommendation}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="max-w-md space-y-1">
                        {row.reasons.length === 0 && row.warnings.length === 0 ? (
                          <span className="text-xs text-[var(--muted)]">No major signal.</span>
                        ) : null}
                        {marketLineDetails[row.driverId]?.rationale ? (
                          <p className="text-xs leading-5 text-amber-300">
                            {marketLineDetails[row.driverId].rationale}
                          </p>
                        ) : null}
                        {row.reasons.map((reason) => (
                          <p key={reason} className="text-xs leading-5 text-green-300">{reason}</p>
                        ))}
                    {row.warnings.map((warning) => (
                      <p key={warning} className="text-xs leading-5 text-red-300">{warning}</p>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
