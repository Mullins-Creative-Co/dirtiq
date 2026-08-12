"use client";

import { useActionState } from "react";

import { saveModelRaceReviewAction } from "@/app/actions";
import { missReasonOptions, type ModelMissReason, type ModelRaceReview } from "@/lib/model-race-review-options";

type ModelRaceReviewFormProps = {
  raceId: number;
  suggestedReason: string;
  review: ModelRaceReview | null;
};

function suggestedToReason(value: string): ModelMissReason {
  const text = value.toLowerCase();
  if (text.includes("playable")) return "playable_group";
  if (text.includes("field")) return "bad_field_data";
  if (text.includes("missing")) return "missing_race_night_inputs";
  if (text.includes("track")) return "track_history_miss";
  if (text.includes("specialist")) return "local_specialist_miss";
  if (text.includes("quick time")) return "quick_time_overrated";
  if (text.includes("lineup") || text.includes("passing")) return "lineup_or_passing";
  return "needs_feature_review";
}

export function ModelRaceReviewForm({
  raceId,
  suggestedReason,
  review,
}: ModelRaceReviewFormProps) {
  const [state, formAction, pending] = useActionState(saveModelRaceReviewAction, {});
  const defaultReason = review?.miss_reason ?? suggestedToReason(suggestedReason);
  const confidence = review?.confidence ?? 0.5;

  return (
    <form action={formAction} className="min-w-[260px] space-y-3">
      <input type="hidden" name="race_id" value={raceId} />

      <div>
        <label className="text-[10px] font-black uppercase tracking-wider text-[var(--muted)]">
          Review reason
        </label>
        <select
          name="miss_reason"
          defaultValue={defaultReason}
          className="mt-1 w-full border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-2 text-xs text-white outline-none focus:border-[var(--accent)]"
        >
          {missReasonOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
        {[
          ["quick_time_mattered", "QT mattered", review?.quick_time_mattered],
          ["starting_position_mattered", "Start mattered", review?.starting_position_mattered],
          ["local_track_history_mattered", "Track/local", review?.local_track_history_mattered],
          ["should_be_feature", "Test feature", review?.should_be_feature],
        ].map(([name, label, checked]) => (
          <label key={String(name)} className="flex items-center gap-2 border border-[var(--border)] bg-black/10 px-2 py-2">
            <input
              type="checkbox"
              name={String(name)}
              defaultChecked={Boolean(checked)}
              className="h-3.5 w-3.5 accent-amber-500"
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div>
        <label className="text-[10px] font-black uppercase tracking-wider text-[var(--muted)]">
          Confidence
        </label>
        <input
          name="confidence"
          type="number"
          min="0"
          max="1"
          step="0.05"
          defaultValue={confidence}
          className="mt-1 w-full border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-2 text-xs text-white outline-none focus:border-[var(--accent)]"
        />
      </div>

      <textarea
        name="notes"
        defaultValue={review?.notes ?? ""}
        rows={2}
        placeholder="What should Dirt IQ remember next time?"
        className="w-full border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-2 text-xs leading-5 text-white outline-none placeholder:text-slate-600 focus:border-[var(--accent)]"
      />

      <div className="flex items-center justify-between gap-3">
        <button
          type="submit"
          disabled={pending}
          className="border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white disabled:opacity-60"
        >
          {pending ? "Saving" : review ? "Update Review" : "Save Review"}
        </button>
        <span className="text-[10px] text-[var(--muted)]">
          {review ? "Saved" : "Unsaved"}
        </span>
      </div>
      {state?.error ? <p className="text-[11px] text-red-300">{state.error}</p> : null}
    </form>
  );
}
