"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { applyPreviousDayFieldCarryForwardAction, applySeriesCommitmentConflictsAction } from "@/app/actions";

export function SeriesConflictPanel({ raceId }: { raceId: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function applyConflicts() {
    setStatus("Checking full-time series commitments...");
    startTransition(async () => {
      const result = await applySeriesCommitmentConflictsAction(raceId);
      if (result.error) {
        setStatus(result.error);
        return;
      }

      setStatus(
        `Checked ${result.conflicts ?? 0} conflicts; scratched ${result.scratched ?? 0}; kept ${result.skippedConfirmed ?? 0} confirmed entries.`
      );
      router.refresh();
    });
  }

  function carryForwardField() {
    setStatus("Checking yesterday's same-track field...");
    startTransition(async () => {
      const result = await applyPreviousDayFieldCarryForwardAction(raceId);
      if (result.error) {
        setStatus(result.error);
        return;
      }

      if (!result.previousRaceId) {
        setStatus("No completed same-track race found from the prior two days.");
        return;
      }

      setStatus(
        `Used ${result.previousRaceName}; confirmed ${result.confirmed ?? 0}, added ${result.added ?? 0}, scratched ${result.scratched ?? 0}, and now watching ${result.unconfirmed ?? 0} unconfirmed entries.`
      );
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-orange-500/30 bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">Field Sanity</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Apply full-time series conflicts, then carry forward the previous same-track field for multi-night shows.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={carryForwardField}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20"
          >
            Carry Forward Field
          </button>
          <button
            type="button"
            onClick={applyConflicts}
            className="rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-xs font-bold text-orange-200 hover:bg-orange-500/20"
          >
            Apply Conflicts
          </button>
        </div>
      </div>
      {status ? <p className="mt-3 text-xs font-semibold text-amber-300">{status}</p> : null}
    </div>
  );
}
