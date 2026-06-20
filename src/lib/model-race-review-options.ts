export type ModelMissReason =
  | "correct_top_pick"
  | "playable_group"
  | "bad_field_data"
  | "missing_race_night_inputs"
  | "track_history_miss"
  | "similar_track_miss"
  | "local_specialist_miss"
  | "recent_form_miss"
  | "quick_time_overrated"
  | "lineup_or_passing"
  | "random_variance"
  | "needs_feature_review";

export type ModelRaceReview = {
  race_id: number;
  miss_reason: ModelMissReason;
  quick_time_mattered: number;
  starting_position_mattered: number;
  local_track_history_mattered: number;
  should_be_feature: number;
  confidence: number;
  notes: string | null;
  updated_at: string;
};

export const missReasonOptions: Array<{ value: ModelMissReason; label: string }> = [
  { value: "correct_top_pick", label: "Correct top pick" },
  { value: "playable_group", label: "Playable group" },
  { value: "bad_field_data", label: "Bad field data" },
  { value: "missing_race_night_inputs", label: "Missing race-night inputs" },
  { value: "track_history_miss", label: "Track-history miss" },
  { value: "similar_track_miss", label: "Similar-track miss" },
  { value: "local_specialist_miss", label: "Local specialist miss" },
  { value: "recent_form_miss", label: "Recent-form miss" },
  { value: "quick_time_overrated", label: "Quick time overrated" },
  { value: "lineup_or_passing", label: "Lineup/passing volatility" },
  { value: "random_variance", label: "Random variance" },
  { value: "needs_feature_review", label: "Needs feature review" },
];
