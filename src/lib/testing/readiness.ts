import "server-only";

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { getDatabasePath, getDb } from "@/lib/db";

export type ReadinessStat = {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "warn" | "neutral";
};

export type TodayAction = {
  title: string;
  detail: string;
  href: string;
  status: "Ready" | "Needs work" | "Review";
};

export type ModelArtifact = {
  name: string;
  series: string;
  engine: string;
  algorithm: string;
  trainedOn: string;
  testAuc: number | null;
  trainAuc: number | null;
  testLogloss: number | null;
  top1Accuracy: number | null;
  featureCount: number;
  updatedAt: string | null;
};

export type DriverProfileSignal = {
  signal: string;
  starts: number;
  winRate: number | null;
  top3Rate: number | null;
  baselineWinRate: number | null;
  baselineTop3Rate: number | null;
};

export type DriverProfileAudit = {
  driver: string;
  starts: number;
  wins: number;
  top3s: number;
  winRate: number;
  top3Rate: number;
  signals: DriverProfileSignal[];
  updatedAt: string | null;
};

export type TestingReadiness = {
  stats: ReadinessStat[];
  todayActions: TodayAction[];
  modelArtifacts: ModelArtifact[];
  driverProfiles: DriverProfileAudit[];
};

type CountRow = { n: number };

function count(sql: string) {
  return (getDb().prepare(sql).get() as CountRow).n;
}

function pct(numerator: number, denominator: number) {
  if (denominator === 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function modelArtifacts(): ModelArtifact[] {
  const dataDir = dirname(getDatabasePath());
  if (!existsSync(dataDir)) return [];

  return readdirSync(dataDir)
    .filter((name) => name.startsWith("feature_params") && name.endsWith(".json"))
    .map((name) => {
      const path = join(dataDir, name);
      const raw = JSON.parse(readFileSync(path, "utf-8")) as {
        features?: string[];
        series?: string;
        model_engine?: string;
        model_algorithm?: string;
        trained_on?: string;
        test_auc?: number;
        train_auc?: number;
        test_logloss?: number;
        top1_acc?: number;
      };
      const updatedAt = statSync(path).mtime;

      return {
        name,
        series: raw.series ?? name.replace(/^feature_params_/, "").replace(/\.json$/, ""),
        engine: raw.model_engine ?? "legacy metadata",
        algorithm: raw.model_algorithm ?? "Unknown",
        trainedOn: raw.trained_on ?? "Unknown training window",
        testAuc: typeof raw.test_auc === "number" ? raw.test_auc : null,
        trainAuc: typeof raw.train_auc === "number" ? raw.train_auc : null,
        testLogloss: typeof raw.test_logloss === "number" ? raw.test_logloss : null,
        top1Accuracy: typeof raw.top1_acc === "number" ? raw.top1_acc : null,
        featureCount: raw.features?.length ?? 0,
        updatedAt: formatDate(updatedAt),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function driverProfiles(): DriverProfileAudit[] {
  const dataDir = dirname(getDatabasePath());
  const profileDir = join(dataDir, "driver-profiles");
  if (!existsSync(profileDir)) return [];

  return readdirSync(profileDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const path = join(profileDir, name);
      const raw = JSON.parse(readFileSync(path, "utf-8")) as Omit<DriverProfileAudit, "updatedAt">;
      return {
        ...raw,
        updatedAt: formatDate(statSync(path).mtime),
      };
    })
    .sort((a, b) => a.driver.localeCompare(b.driver));
}

export function getTestingReadiness(): TestingReadiness {
  const races = count("SELECT COUNT(*) AS n FROM races");
  const completedRaces = count("SELECT COUNT(*) AS n FROM races WHERE status = 'complete'");
  const upcomingRaces = count("SELECT COUNT(*) AS n FROM races WHERE status = 'upcoming'");
  const entries = count("SELECT COUNT(*) AS n FROM race_entries");
  const entriesWithFinish = count("SELECT COUNT(*) AS n FROM race_entries WHERE finishing_position IS NOT NULL");
  const entriesWithStart = count("SELECT COUNT(*) AS n FROM race_entries WHERE starting_position IS NOT NULL");
  const entriesWithQual = count("SELECT COUNT(*) AS n FROM race_entries WHERE qualifying_time IS NOT NULL");
  const entriesWithHeat = count("SELECT COUNT(*) AS n FROM race_entries WHERE heat_position IS NOT NULL");
  const drivers = count("SELECT COUNT(*) AS n FROM drivers");
  const tracks = count("SELECT COUNT(*) AS n FROM tracks");
  const driverMetrics = count("SELECT COUNT(*) AS n FROM driver_model_metrics");
  const equipmentProfiles = count("SELECT COUNT(*) AS n FROM driver_equipment_profiles");
  const artifacts = modelArtifacts();
  const profiles = driverProfiles();
  const nextRace = getDb()
    .prepare(
      `SELECT id FROM races WHERE status = 'upcoming' ORDER BY race_date ASC, id ASC LIMIT 1`
    )
    .get() as { id: number } | undefined;

  return {
    stats: [
      {
        label: "Historical races",
        value: formatNumber(completedRaces),
        detail: `${formatNumber(races)} total races, ${formatNumber(upcomingRaces)} upcoming`,
        tone: completedRaces >= 50 ? "good" : "warn",
      },
      {
        label: "Driver entries",
        value: formatNumber(entries),
        detail: `${pct(entriesWithFinish, entries)} have finish labels`,
        tone: entriesWithFinish / Math.max(entries, 1) > 0.9 ? "good" : "warn",
      },
      {
        label: "Pre-race coverage",
        value: pct(entriesWithStart + entriesWithQual + entriesWithHeat, entries * 3),
        detail: `${pct(entriesWithStart, entries)} start, ${pct(entriesWithQual, entries)} qual, ${pct(entriesWithHeat, entries)} heat`,
        tone: entriesWithStart > 0 && entriesWithQual > 0 && entriesWithHeat > 0 ? "good" : "warn",
      },
      {
        label: "Entities",
        value: `${formatNumber(drivers)} / ${formatNumber(tracks)}`,
        detail: "drivers / tracks in database",
        tone: drivers > 0 && tracks > 0 ? "good" : "warn",
      },
      {
        label: "Driver metrics",
        value: formatNumber(driverMetrics),
        detail: `${formatNumber(equipmentProfiles)} equipment profiles imported`,
        tone: driverMetrics > 0 ? "good" : "warn",
      },
      {
        label: "Model artifacts",
        value: formatNumber(artifacts.length),
        detail: artifacts.length > 0 ? "feature params found in data folder" : "train the model to create artifacts",
        tone: artifacts.length > 0 ? "good" : "warn",
      },
    ],
    todayActions: [
      {
        title: "Review the one upcoming race",
        detail: "Confirm entries, starting spots, heat positions, and track condition before trusting projections.",
        href: "/admin/races",
        status: upcomingRaces > 0 ? "Ready" : "Needs work",
      },
      {
        title: "Open the prediction card",
        detail: "Turn the current model probabilities into Play, Lean, and Pass calls for race day.",
        href: nextRace ? `/admin/races/${nextRace.id}/prediction` : "/admin/races",
        status: nextRace ? "Ready" : "Needs work",
      },
      {
        title: "Open odds intelligence",
        detail: "Use the model page to compare ranked drivers and check whether the favorite story makes sense.",
        href: "/admin/model",
        status: completedRaces > 0 ? "Ready" : "Needs work",
      },
      {
        title: "Run backtest review",
        detail: "Check blended, Elo-only, and composite-only behavior before adding new bet rules.",
        href: "/admin/backtest",
        status: completedRaces >= 10 ? "Ready" : "Review",
      },
      {
        title: "Import missing recaps or standings",
        detail: "Use the import page for new WoO recaps and season standings when the next event finishes.",
        href: "/admin/import",
        status: "Review",
      },
    ],
    modelArtifacts: artifacts,
    driverProfiles: profiles,
  };
}
