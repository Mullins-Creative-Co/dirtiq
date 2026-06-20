import "server-only";

import { existsSync } from "node:fs";

import { getDatabasePath } from "@/lib/db";
import { hasLiveBetDatabase } from "@/lib/live-bets-db";

export type StorageStatus = {
  runtime: "vercel" | "local";
  raceStore: "sqlite_local" | "sqlite_vercel_tmp";
  publicBetStore: "neon" | "sqlite";
  databasePath: string;
  hasSeed: boolean;
  needsHostedRaceStore: boolean;
  summary: string;
};

export function getStorageStatus(): StorageStatus {
  const runtime = process.env.VERCEL ? "vercel" : "local";
  const publicBetStore = hasLiveBetDatabase() ? "neon" : "sqlite";
  const raceStore = runtime === "vercel" ? "sqlite_vercel_tmp" : "sqlite_local";
  const databasePath = getDatabasePath();
  const hasSeed = existsSync("public/data/dirtiq.seed.db");

  return {
    runtime,
    raceStore,
    publicBetStore,
    databasePath,
    hasSeed,
    needsHostedRaceStore: raceStore === "sqlite_vercel_tmp",
    summary:
      runtime === "vercel" && publicBetStore === "neon"
        ? "Public bets are durable in Neon; race/admin state is still temporary SQLite."
        : runtime === "vercel"
          ? "Production is still temporary SQLite. Live changes can reset on cold start or deploy."
          : "Local development is using the SQLite file on this computer.",
  };
}
