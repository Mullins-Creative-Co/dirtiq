import "server-only";

import { priceOutrightWinnerLines } from "@/lib/book-pricing";
import { getDb } from "@/lib/db";
import { getMarketLineDetailMap, getOutrightExposureMap } from "@/lib/market-lines";
import { buildPredictionCard } from "@/lib/prediction-card";
import { generateProps, type PropMarket, type PropType } from "@/lib/player-bets";
import { isFocusedModelSeries, todayDateString, type Race } from "@/lib/races";

export type TodayOutrightLine = {
  rank: number;
  driverId: number;
  driverName: string;
  carNumber: string | null;
  modelProbability: number;
  fairOdds: string;
  marketOdds: string;
  recommendation: "Play" | "Lean" | "Pass";
  confidence: "High" | "Medium" | "Low";
  entryStatus: "confirmed" | "expected" | "unconfirmed" | "scratched";
  reasons: string[];
  warnings: string[];
  source: string;
  updatedAt: string | null;
};

export type TodayPropLine = {
  type: PropType;
  section: string;
  description: string;
  marketOdds: string;
  impliedProbability: number;
  driverName: string | null;
  driverBName: string | null;
};

export type TodayRaceBoard = {
  race: Race;
  fieldSize: number;
  readiness: {
    entries: number;
    qualifying: number;
    heats: number;
    starts: number;
  };
  lineStatus: "published" | "preview" | "empty";
  lastPublishedAt: string | null;
  topOutrights: TodayOutrightLine[];
  propsByType: Array<{
    type: PropType;
    label: string;
    lines: TodayPropLine[];
  }>;
};

function listTodayFocusedRaces(): Race[] {
  return getDb()
    .prepare(
      `SELECT r.*, t.name AS track_name
       FROM races r
       JOIN tracks t ON t.id = r.track_id
       WHERE r.race_date = ?
         AND r.status = 'upcoming'
         AND lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) NOT LIKE '%sprint%'
       ORDER BY
         CASE WHEN r.is_live = 1 THEN 0 ELSE 1 END,
         CASE COALESCE(r.betting_status, 'open')
           WHEN 'open' THEN 0
           WHEN 'locked' THEN 1
           ELSE 2
         END,
         r.id ASC`
    )
    .all(todayDateString()) as Race[];
}

function propLabel(type: PropType) {
  if (type === "top3") return "Top 3";
  if (type === "h2h") return "Head to Head";
  if (type === "laps_led") return "Leads a Lap";
  if (type === "dnf") return "DNF";
  if (type === "top5") return "Top 5";
  return "Winner";
}

function propScore(prop: PropMarket, topRanks: Map<number, number>) {
  const primaryRank = prop.driver_id ? topRanks.get(prop.driver_id) ?? 99 : 99;
  const secondaryRank = prop.driver_b_id ? topRanks.get(prop.driver_b_id) ?? 99 : 99;
  const typeBoost = prop.type === "top3" ? 12 : prop.type === "h2h" ? 9 : prop.type === "laps_led" ? 6 : 3;
  return typeBoost + Math.max(0, 20 - primaryRank) + Math.max(0, 10 - secondaryRank);
}

function buildPropGroups(race: Race, topRanks: Map<number, number>): TodayRaceBoard["propsByType"] {
  const wantedTypes: PropType[] = ["top3", "h2h", "laps_led", "dnf"];
  const props = generateProps(race.id, race.track_id)
    .filter((prop) => wantedTypes.includes(prop.type))
    .sort((a, b) => propScore(b, topRanks) - propScore(a, topRanks));

  return wantedTypes.flatMap((type) => {
    const limit = type === "h2h" ? 6 : 5;
    const lines = props
      .filter((prop) => prop.type === type)
      .slice(0, limit)
      .map((prop) => ({
        type: prop.type,
        section: prop.section,
        description: prop.description,
        marketOdds: prop.american_odds,
        impliedProbability: prop.implied_probability,
        driverName: prop.driver_name,
        driverBName: prop.driver_b_name,
      }));
    return lines.length > 0 ? [{ type, label: propLabel(type), lines }] : [];
  });
}

export function getTodayMarketBoards(): TodayRaceBoard[] {
  return listTodayFocusedRaces()
    .filter(isFocusedModelSeries)
    .flatMap((race) => {
      const card = buildPredictionCard(race.id);
      if (!card) return [];

      const publishedLines = getMarketLineDetailMap(race.id);
      const previewPrices = new Map(
        priceOutrightWinnerLines(card, getOutrightExposureMap(race.id)).map((line) => [line.driverId, line])
      );
      const publishedEntries = Object.values(publishedLines);
      const topOutrights = card.rows
        .filter((row) => row.entryStatus !== "scratched")
        .slice(0, 10)
        .map((row) => {
          const published = publishedLines[row.driverId];
          const preview = previewPrices.get(row.driverId);
          return {
            rank: row.rank,
            driverId: row.driverId,
            driverName: row.driverName,
            carNumber: row.carNumber,
            modelProbability: row.modelProbability,
            fairOdds: row.fairOdds,
            marketOdds: published?.marketOdds ?? preview?.americanOdds ?? row.fairOdds,
            recommendation: row.recommendation,
            confidence: row.confidence,
            entryStatus: row.entryStatus,
            reasons: row.reasons,
            warnings: row.warnings,
            source: published?.source ?? (preview ? `${preview.stage} preview` : "model fair"),
            updatedAt: published?.updatedAt ?? null,
          };
        });
      const topRanks = new Map(topOutrights.map((line) => [line.driverId, line.rank]));

      return [{
        race,
        fieldSize: card.fieldSize,
        readiness: card.readiness,
        lineStatus: publishedEntries.length > 0 ? "published" : topOutrights.length > 0 ? "preview" : "empty",
        lastPublishedAt: publishedEntries.reduce<string | null>(
          (latest, line) => (!latest || line.updatedAt > latest ? line.updatedAt : latest),
          null
        ),
        topOutrights,
        propsByType: buildPropGroups(race, topRanks),
      }];
    });
}
