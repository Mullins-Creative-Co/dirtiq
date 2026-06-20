import "server-only";

import { getDb } from "@/lib/db";
import { oddsToMultiplier } from "@/lib/book";
import { getRiskLimits } from "@/lib/book";
import { ensureLiveBetTables, getLiveBetSql, hasLiveBetDatabase } from "@/lib/live-bets-db";
import type { PropMarket, PropType } from "@/lib/player-bets";

export type UnderwritingSelection = {
  race_id: number;
  prop_type: PropType;
  description: string;
  driver_id: number | null;
  driver_b_id: number | null;
  american_odds: string;
};

export type PublicRiskCorridor = {
  key: string;
  maxStake: number;
  status: "open" | "limited" | "closed";
  message: string | null;
};

export type UnderwritingAssessment = PublicRiskCorridor & {
  totalHandle: number;
  currentSelectionPayout: number;
  riskBudget: number;
  riskLimitedStake: number;
  payoutLimitedStake: number | null;
  maxBetSize: number | null;
};

export type PublicSportsbookExposure = {
  totalHandle: number;
  totalTickets: number;
  worstSelectionPayout: number;
  worstCasePl: number;
  selections: Array<{
    key: string;
    prop_type: PropType;
    description: string;
    driver_id: number | null;
    driver_b_id: number | null;
    american_odds: string;
    tickets: number;
    total_staked: number;
    payout_if_win: number;
    net_pl_if_win: number;
    corridor: PublicRiskCorridor;
  }>;
};

const DEFAULT_RISK_BUDGET = 250;

export function underwritingKey(selection: {
  prop_type?: PropType;
  type?: PropType;
  driver_id: number | null;
  driver_b_id: number | null;
  description: string;
  american_odds: string;
}) {
  return [
    selection.prop_type ?? selection.type,
    selection.driver_id ?? "none",
    selection.driver_b_id ?? "none",
    selection.description,
    selection.american_odds,
  ].join("|");
}

function dollars(value: number) {
  return Math.floor(Math.max(0, value) * 100) / 100;
}

function riskBudget() {
  const configured = Number(process.env.DIRTIQ_RISK_BUDGET_PER_RACE);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_RISK_BUDGET;
}

async function getPublicRaceHandle(raceId: number) {
  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) return 0;
    const [row] = (await sql`
      SELECT COALESCE(SUM(stake), 0) AS handle
      FROM player_bets
      WHERE race_id = ${raceId} AND status = 'open'
    `) as Array<Record<string, unknown>>;
    return Number(row?.handle ?? 0);
  }

  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(stake), 0) AS handle
       FROM player_bets
       WHERE race_id = ? AND status = 'open'`
    )
    .get(raceId) as { handle: number };
  return Number(row.handle ?? 0);
}

function getManualRaceHandle(raceId: number) {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS handle
       FROM bets
       WHERE race_id = ? AND status = 'open'`
    )
    .get(raceId) as { handle: number };
  return Number(row.handle ?? 0);
}

async function getPublicSelectionPayout(selection: UnderwritingSelection) {
  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) return 0;
    const [row] = (await sql`
      SELECT COALESCE(SUM(payout_if_win), 0) AS payout
      FROM player_bets
      WHERE race_id = ${selection.race_id}
        AND status = 'open'
        AND prop_type = ${selection.prop_type}
        AND description = ${selection.description}
        AND (
          (${selection.driver_id} IS NULL AND driver_id IS NULL)
          OR driver_id = ${selection.driver_id}
        )
        AND (
          (${selection.driver_b_id} IS NULL AND driver_b_id IS NULL)
          OR driver_b_id = ${selection.driver_b_id}
        )
    `) as Array<Record<string, unknown>>;
    return Number(row?.payout ?? 0);
  }

  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(payout_if_win), 0) AS payout
       FROM player_bets
       WHERE race_id = ?
         AND status = 'open'
         AND prop_type = ?
         AND description = ?
         AND ((? IS NULL AND driver_id IS NULL) OR driver_id = ?)
         AND ((? IS NULL AND driver_b_id IS NULL) OR driver_b_id = ?)`
    )
    .get(
      selection.race_id,
      selection.prop_type,
      selection.description,
      selection.driver_id,
      selection.driver_id,
      selection.driver_b_id,
      selection.driver_b_id,
    ) as { payout: number };
  return Number(row.payout ?? 0);
}

export async function assessPlayerBetUnderwriting(
  selection: UnderwritingSelection,
  stake = 0,
): Promise<UnderwritingAssessment> {
  const limits = getRiskLimits(selection.race_id);
  const multiplier = oddsToMultiplier(selection.american_odds);
  const totalHandle = (await getPublicRaceHandle(selection.race_id)) + getManualRaceHandle(selection.race_id);
  const currentSelectionPayout = await getPublicSelectionPayout(selection);
  const budget = riskBudget();
  const riskRoom = totalHandle + budget - currentSelectionPayout;
  const riskLimitedStake = multiplier > 0 ? dollars(riskRoom / multiplier) : 0;
  const payoutLimitedStake =
    limits.max_payout_per_driver === null
      ? null
      : dollars((limits.max_payout_per_driver - currentSelectionPayout) / (1 + multiplier));
  const candidates = [
    riskLimitedStake,
    ...(payoutLimitedStake === null ? [] : [payoutLimitedStake]),
    ...(limits.max_bet_size === null ? [] : [limits.max_bet_size]),
  ];
  const maxStake = dollars(Math.min(...candidates));
  const key = underwritingKey(selection);
  const status = maxStake < 0.01 ? "closed" : maxStake < 25 ? "limited" : "open";
  const message =
    status === "closed"
      ? "Market capped"
      : status === "limited"
        ? `Max ${maxStake.toLocaleString("en-US", { style: "currency", currency: "USD" })}`
        : null;

  if (stake > 0 && stake > maxStake + 0.001) {
    throw new Error(
      maxStake < 0.01
        ? "This market is temporarily capped. Try another selection."
        : `Stake exceeds current max of ${maxStake.toLocaleString("en-US", { style: "currency", currency: "USD" })} for this selection.`
    );
  }

  return {
    key,
    maxStake,
    status,
    message,
    totalHandle,
    currentSelectionPayout,
    riskBudget: budget,
    riskLimitedStake,
    payoutLimitedStake,
    maxBetSize: limits.max_bet_size,
  };
}

export async function getMarketRiskCorridors(
  raceId: number,
  markets: PropMarket[],
): Promise<Record<string, PublicRiskCorridor>> {
  const entries = await Promise.all(
    markets.map(async (market) => {
      const assessment = await assessPlayerBetUnderwriting({
        race_id: raceId,
        prop_type: market.type,
        description: market.description,
        driver_id: market.driver_id,
        driver_b_id: market.driver_b_id,
        american_odds: market.american_odds,
      });

      return [
        assessment.key,
        {
          key: assessment.key,
          maxStake: assessment.maxStake,
          status: assessment.status,
          message: assessment.message,
        },
      ] as const;
    }),
  );

  return Object.fromEntries(entries);
}

export async function getPublicSportsbookExposure(raceId: number): Promise<PublicSportsbookExposure> {
  const rows = hasLiveBetDatabase()
    ? await (async () => {
        await ensureLiveBetTables();
        const sql = getLiveBetSql();
        if (!sql) return [];
        return (await sql`
          SELECT prop_type,
                 description,
                 driver_id,
                 driver_b_id,
                 american_odds,
                 COUNT(*) AS tickets,
                 COALESCE(SUM(stake), 0) AS total_staked,
                 COALESCE(SUM(payout_if_win), 0) AS payout_if_win
          FROM player_bets
          WHERE race_id = ${raceId} AND status = 'open'
          GROUP BY prop_type, description, driver_id, driver_b_id, american_odds
          ORDER BY payout_if_win DESC
        `) as Array<Record<string, unknown>>;
      })()
    : (getDb()
        .prepare(
          `SELECT prop_type,
                  description,
                  driver_id,
                  driver_b_id,
                  american_odds,
                  COUNT(*) AS tickets,
                  COALESCE(SUM(stake), 0) AS total_staked,
                  COALESCE(SUM(payout_if_win), 0) AS payout_if_win
           FROM player_bets
           WHERE race_id = ? AND status = 'open'
           GROUP BY prop_type, description, driver_id, driver_b_id, american_odds
           ORDER BY payout_if_win DESC`
        )
        .all(raceId) as Array<Record<string, unknown>>);

  const totalHandle = rows.reduce((sum, row) => sum + Number(row.total_staked ?? 0), 0);
  const selections = await Promise.all(
    rows.map(async (row) => {
      const selection = {
        race_id: raceId,
        prop_type: row.prop_type as PropType,
        description: String(row.description),
        driver_id: row.driver_id == null ? null : Number(row.driver_id),
        driver_b_id: row.driver_b_id == null ? null : Number(row.driver_b_id),
        american_odds: String(row.american_odds),
      };
      const assessment = await assessPlayerBetUnderwriting(selection);
      const payoutIfWin = Number(row.payout_if_win ?? 0);
      return {
        key: assessment.key,
        prop_type: selection.prop_type,
        description: selection.description,
        driver_id: selection.driver_id,
        driver_b_id: selection.driver_b_id,
        american_odds: selection.american_odds,
        tickets: Number(row.tickets ?? 0),
        total_staked: Number(row.total_staked ?? 0),
        payout_if_win: payoutIfWin,
        net_pl_if_win: totalHandle - payoutIfWin,
        corridor: {
          key: assessment.key,
          maxStake: assessment.maxStake,
          status: assessment.status,
          message: assessment.message,
        },
      };
    }),
  );

  const worstSelectionPayout = selections[0]?.payout_if_win ?? 0;

  return {
    totalHandle,
    totalTickets: selections.reduce((sum, row) => sum + row.tickets, 0),
    worstSelectionPayout,
    worstCasePl: totalHandle - worstSelectionPayout,
    selections,
  };
}
