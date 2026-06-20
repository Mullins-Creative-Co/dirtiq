import { Nav } from "@/components/nav";
import { connection } from "next/server";
import { TestingWorkbench } from "@/components/testing/testing-workbench";
import {
  modelLayers,
  testingTasks,
  validationStages,
} from "@/lib/testing/plan";
import { getTestingReadiness } from "@/lib/testing/readiness";
import { isActiveModelTarget, listRaces } from "@/lib/races";
import { buildPredictionCard } from "@/lib/prediction-card";
import { getModelAccuracyDashboard } from "@/lib/model-accuracy";
import { getModelDataQuality } from "@/lib/model-data-quality";
import { getModelRaceReviewMap } from "@/lib/model-race-reviews";
import { getCrownReplay } from "@/lib/crown-replay";
import { getHistoricalBackfillPlan } from "@/lib/historical-backfill";

export default async function TestingPage() {
  await connection();
  const readiness = getTestingReadiness();
  const upcoming = listRaces()
    .filter((race) => race.status === "upcoming" && isActiveModelTarget(race))
    .slice(0, 8)
    .map((race) => {
      const card = buildPredictionCard(race.id);
      return {
        id: race.id,
        name: race.name,
        trackName: race.track_name,
        raceDate: race.race_date,
        division: race.division,
        fieldSize: card?.fieldSize ?? 0,
        readiness: card?.readiness ?? { entries: 0, starts: 0, qualifying: 0, heats: 0 },
        topPicks: (card?.rows ?? []).slice(0, 5).map((row) => ({
          rank: row.rank,
          driverName: row.driverName,
          probability: row.modelProbability,
          fairOdds: row.fairOdds,
          recommendation: row.recommendation,
          confidence: row.confidence,
          reasons: row.reasons,
          warnings: row.warnings,
          mlProbability: row.mlProbability,
          mlModelSeries: row.mlModelSeries,
        })),
      };
    });
  const accuracy = getModelAccuracyDashboard(60);
  const historicalRows = accuracy.rows.slice(0, 6);
  const reviewMap = getModelRaceReviewMap(historicalRows.map((row) => row.raceId));
  const historical = {
    summary: accuracy.summary,
    signals: accuracy.signals,
    rows: historicalRows.map((row) => ({
      ...row,
      review: reviewMap.get(row.raceId) ?? null,
    })),
  };
  const dataQuality = getModelDataQuality();
  const crownReplay = getCrownReplay();
  const historicalBackfill = getHistoricalBackfillPlan();

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-6xl px-3 pb-28 pt-4 sm:px-6 sm:py-8">
        <TestingWorkbench
          tasks={testingTasks}
          modelLayers={modelLayers}
          validationStages={validationStages}
          readiness={readiness}
          upcoming={JSON.parse(JSON.stringify(upcoming))}
          historical={JSON.parse(JSON.stringify(historical))}
          dataQuality={JSON.parse(JSON.stringify(dataQuality))}
          crownReplay={JSON.parse(JSON.stringify(crownReplay))}
          historicalBackfill={JSON.parse(JSON.stringify(historicalBackfill))}
        />
      </main>
    </div>
  );
}
