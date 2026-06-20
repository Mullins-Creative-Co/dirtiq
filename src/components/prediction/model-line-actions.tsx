"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  applyRationalMarketLinesAction,
  clearMarketLinesAction,
  freshModelSlateAction,
  refreshMlPredictionsAction,
} from "@/app/actions";

type ModelLineActionsProps = {
  raceId: number;
  mlScored: number;
  fieldSize: number;
  modelSummary: string;
  oddsFreshness: {
    status: "current" | "needs_publish";
    reason: string;
    lineCount: number;
    fieldSize: number;
    lastPublishedAt: string | null;
  };
};

type Status = {
  tone: "ok" | "warn" | "error";
  message: string;
} | null;

function statusClass(tone: "ok" | "warn" | "error") {
  if (tone === "ok") return "text-green-300";
  if (tone === "warn") return "text-amber-300";
  return "text-red-300";
}

export function ModelLineActions({
  raceId,
  mlScored,
  fieldSize,
  modelSummary,
  oddsFreshness,
}: ModelLineActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(null);

  function refreshModel(model: "auto" | "crown" | "lucas" | "woo" | "summer" = "auto") {
    const modelLabels = {
      auto: "race",
      crown: "crown jewel",
      lucas: "Lucas",
      woo: "WoO",
      summer: "Summer Nationals",
    };
    setStatus({
      tone: "warn",
      message: `Scoring ${modelLabels[model]} model...`,
    });

    startTransition(async () => {
      const result = await refreshMlPredictionsAction(raceId, model);
      if (result.error) {
        setStatus({ tone: "error", message: result.error });
        return;
      }

      setStatus({
        tone: result.scored && result.scored > 0 ? "ok" : "warn",
        message: `Model cache refreshed for ${result.scored ?? 0} drivers.`,
      });
      router.refresh();
    });
  }

  function applyLines() {
    setStatus({ tone: "warn", message: "Publishing odds..." });

    startTransition(async () => {
      const result = await applyRationalMarketLinesAction(raceId);
      if (result.error) {
        setStatus({ tone: "error", message: result.error });
        return;
      }

      setStatus({
        tone: "ok",
        message: `Published ${result.linesWritten ?? 0} odds from ${result.source ?? "model"}.`,
      });
      router.refresh();
    });
  }

  function clearLines() {
    if (!window.confirm("Clear all published odds for this race? Model scores and underwriting notes will stay.")) {
      return;
    }

    setStatus({ tone: "warn", message: "Clearing published odds..." });

    startTransition(async () => {
      const result = await clearMarketLinesAction(raceId);
      if (result.error) {
        setStatus({ tone: "error", message: result.error });
        return;
      }

      setStatus({
        tone: "ok",
        message: `Cleared ${result.deleted ?? 0} published odds. Model picks are still visible.`,
      });
      router.refresh();
    });
  }

  function freshSlate() {
    if (!window.confirm("Start fresh from the model? This clears current odds, refreshes XGBoost, then publishes new model odds.")) {
      return;
    }

    setStatus({ tone: "warn", message: "Refreshing model and rebuilding odds from scratch..." });

    startTransition(async () => {
      const result = await freshModelSlateAction(raceId);
      if (result.error) {
        setStatus({ tone: "error", message: result.error });
        return;
      }

      setStatus({
        tone: "ok",
        message: `Fresh slate complete: cleared ${result.deleted ?? 0}, scored ${result.scored ?? 0}, published ${result.linesWritten ?? 0} odds from ${result.source ?? "model"}.`,
      });
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
            Model to Lines
          </p>
          <p className="mt-1 text-sm text-white">
            {mlScored}/{fieldSize} drivers have cached boost-model scores.
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">{modelSummary}</p>
          <p className={`mt-2 text-xs font-semibold ${oddsFreshness.status === "current" ? "text-green-300" : "text-amber-300"}`}>
            {oddsFreshness.status === "current" ? "Odds current" : "Publish needed"} · {oddsFreshness.reason}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={freshSlate}
            disabled={isPending}
            className="rounded-lg bg-green-400 px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Fresh Model Slate
          </button>
          <button
            type="button"
            onClick={() => refreshModel("auto")}
            disabled={isPending}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)] transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Refresh Model
          </button>
          <button
            type="button"
            onClick={() => refreshModel("crown")}
            disabled={isPending}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Crown Model
          </button>
          <button
            type="button"
            onClick={() => refreshModel("lucas")}
            disabled={isPending}
            className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-200 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Lucas
          </button>
          <button
            type="button"
            onClick={() => refreshModel("woo")}
            disabled={isPending}
            className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-semibold text-green-200 transition-colors hover:bg-green-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            WoO
          </button>
          <button
            type="button"
            onClick={() => refreshModel("summer")}
            disabled={isPending}
            className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-sm font-semibold text-orange-200 transition-colors hover:bg-orange-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Summer
          </button>
          <button
            type="button"
            onClick={applyLines}
            disabled={isPending}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Publish Odds
          </button>
          <button
            type="button"
            onClick={clearLines}
            disabled={isPending}
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Clear Odds
          </button>
        </div>
      </div>
      {status ? (
        <p className={`mt-3 text-xs font-semibold ${statusClass(status.tone)}`}>
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
