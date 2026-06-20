export type TestingTask = {
  id: string;
  title: string;
  lane: "Data" | "Model" | "Backtest" | "Race Day" | "Betting";
  detail: string;
  completedByDefault?: boolean;
};

export type ModelLayer = {
  name: string;
  type: string;
  output: string;
  useCase: string;
};

export type ValidationStage = {
  title: string;
  goal: string;
  checks: string[];
};

export const testingTasks: TestingTask[] = [
  {
    id: "import-results",
    title: "Import clean historical results",
    lane: "Data",
    detail:
      "Load race results, field size, track, finish position, and series data before any model comparison.",
    completedByDefault: true,
  },
  {
    id: "driver-track-intel",
    title: "Fill driver and track intelligence",
    lane: "Data",
    detail:
      "Review driver specialties, equipment notes, track similarity, surface, banking, and race condition notes.",
  },
  {
    id: "lineup-readiness",
    title: "Confirm next-race lineup readiness",
    lane: "Race Day",
    detail:
      "Make sure race entries, pre-race form, heat results, starting spot, and track condition are current.",
  },
  {
    id: "data-lane-audit",
    title: "Audit data lanes after import",
    lane: "Data",
    detail:
      "Confirm Lucas, WoO, driver metrics, equipment, and track intel landed in the expected tables before retraining.",
  },
  {
    id: "current-odds-audit",
    title: "Audit current odds model",
    lane: "Model",
    detail:
      "Compare blended odds, Elo-only, and composite-only rankings against known completed races.",
    completedByDefault: true,
  },
  {
    id: "xgb-targets",
    title: "Define XGBoost target labels",
    lane: "Model",
    detail:
      "Prepare labels for win, top-3, top-5, top-10, laps led, DNF risk, cautions, and head-to-head outcomes.",
    completedByDefault: true,
  },
  {
    id: "leakage-check",
    title: "Run leakage check",
    lane: "Backtest",
    detail:
      "Verify that finished-race fields, closing outcomes, and future event data are blocked from training features.",
  },
  {
    id: "model-routing-refresh",
    title: "Refresh separated model caches",
    lane: "Model",
    detail:
      "Run the maintenance audit, retrain the separated models, and cache upcoming race predictions with the proper Lucas, WoO, or Crown model.",
  },
  {
    id: "backtest-thresholds",
    title: "Set backtest thresholds",
    lane: "Backtest",
    detail:
      "Track favorite win rate, top-3 hit rate, Brier score, calibration, ROI, closing line value, and drawdown.",
  },
  {
    id: "prediction-card",
    title: "Create prediction card format",
    lane: "Race Day",
    detail:
      "Rank picks with model probability, book odds, implied probability, edge, confidence cap, and notes.",
    completedByDefault: true,
  },
  {
    id: "risk-rules",
    title: "Lock betting risk rules",
    lane: "Betting",
    detail:
      "Set max stake, max exposure per driver, edge threshold, market limits, and no-bet conditions.",
    completedByDefault: true,
  },
  {
    id: "late-model-lobby-slips",
    title: "Publish late-model lobby bet slips",
    lane: "Betting",
    detail:
      "Keep the lobby board focused on Lucas Oil LMDS and WoO Late Models with separate race cards and playable props.",
    completedByDefault: true,
  },
  {
    id: "crown-jewel-trend-filter",
    title: "Add crown jewel trend filter",
    lane: "Model",
    detail:
      "Apply Dream/Eldora-style winner-profile criteria such as recent win form, major-event pedigree, and shortlist gates.",
    completedByDefault: true,
  },
  {
    id: "post-race-review",
    title: "Run post-race review loop",
    lane: "Backtest",
    detail:
      "Record results, settle bets, compare predictions to finish order, and update notes for model tuning.",
  },
];

export const modelLayers: ModelLayer[] = [
  {
    name: "Current Blended Odds",
    type: "Composite score plus Elo",
    output: "Win probability and American odds",
    useCase: "Primary live lines and favorite ranking",
  },
  {
    name: "Win Model",
    type: "XGBoost classifier",
    output: "P(win) per driver",
    useCase: "Outright winner bets and matchup foundation",
  },
  {
    name: "Finish Model",
    type: "XGBoost classifier",
    output: "P(top-3), P(top-5), P(top-10)",
    useCase: "Finish props and scorecard confidence",
  },
  {
    name: "Laps Led Model",
    type: "XGBoost regressor",
    output: "Expected laps led per driver",
    useCase: "Dominance and laps-led props",
  },
  {
    name: "DNF Risk Layer",
    type: "Reliability multiplier",
    output: "Driver probability adjustment",
    useCase: "Post-prediction risk adjustment",
  },
  {
    name: "Crown Jewel Trend Filter",
    type: "Event-profile multiplier",
    output: "Dream/Eldora and crown-jewel trend match flags",
    useCase: "Narrow elite-event contenders before betting",
  },
  {
    name: "Bradley-Terry",
    type: "Pairwise ranking model",
    output: "Head-to-head win probability",
    useCase: "Matchup props",
  },
];

export const validationStages: ValidationStage[] = [
  {
    title: "Data Readiness",
    goal: "Know the rows are trustworthy before model work.",
    checks: [
      "One row per driver-race entry",
      "Completed races have winner and finish labels",
      "Race-day fields are separated from post-race outcomes",
      "Track and series names are normalized",
    ],
  },
  {
    title: "Prediction QA",
    goal: "Make the line board explainable and usable.",
    checks: [
      "Probabilities are calibrated by race",
      "Favorite ranking is compared with actual winners",
      "Driver notes explain major model movement",
      "Each prediction carries a data cutoff",
    ],
  },
  {
    title: "Betting Review",
    goal: "Only bet edges that survive backtesting.",
    checks: [
      "Edge threshold is set before race day",
      "Stake sizing respects risk limits",
      "Closing line value is tracked",
      "Post-race result review is completed",
    ],
  },
];
