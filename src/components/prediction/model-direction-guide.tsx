import Link from "next/link";

type Direction = {
  signal: string;
  where: string;
  action: string;
  weight: string;
  example: string;
  href?: string;
};

const directions: Direction[] = [
  {
    signal: "Driver may not be there",
    where: "Entry Status or Live Caveats",
    action: "Mark unconfirmed/scratched, or add a schedule-conflict caveat.",
    weight: "x0.55 to x0.02",
    example: "Davenport schedule does not list this track.",
  },
  {
    signal: "One-race concern",
    where: "Live Caveats",
    action: "Use a multiplier. This affects this race only and will not train the model.",
    weight: "x0.75 light, x0.35 strong",
    example: "Backup car, uncertain entry, mechanical issue, bad draw concern.",
  },
  {
    signal: "Race-specific track fit",
    where: "Race Context",
    action: "Add a small score delta with a source/note.",
    weight: "+0.010 to +0.050",
    example: "Driver has strong local/non-series history at this exact place.",
  },
  {
    signal: "Repeatable track trend",
    where: "Track Intelligence",
    action: "Add a reusable driver-track trend so future races at this track can see it.",
    weight: "+0.005 to +0.035",
    example: "Overton repeatedly runs top 3 at this track when unsanctioned.",
  },
  {
    signal: "Similar-track evidence",
    where: "Track Intelligence",
    action: "Add or tune similar tracks. Keep weights conservative unless geometry/style is very close.",
    weight: "0.30 to 0.70 similarity",
    example: "Smoky Mountain, 411, Tazewell, Cherokee comparison group.",
  },
  {
    signal: "Prelim/night-one result",
    where: "Race Hub inputs/results",
    action: "Enter qualifying, heat, start, and final result. XGBoost can learn this as structured data.",
    weight: "No manual boost first",
    example: "Night 1 winner/top-3 before Night 2.",
  },
  {
    signal: "A story you cannot prove yet",
    where: "Underwriting Notes",
    action: "Save it as a note. Do not move probability until it repeats or has data.",
    weight: "0.000",
    example: "Feels like this driver should be good here.",
  },
];

const scale = [
  { label: "Note", value: "0.000", detail: "information only" },
  { label: "Tiny", value: "0.003-0.010", detail: "prior laps, weak support" },
  { label: "Small", value: "0.010-0.025", detail: "useful evidence" },
  { label: "Medium", value: "0.025-0.050", detail: "clear supported edge" },
  { label: "Large", value: "0.050-0.080", detail: "rare, strong evidence" },
  { label: "Max", value: "0.080-0.150", detail: "avoid unless dominant" },
];

export function ModelDirectionGuide({
  raceId,
  trackId,
}: {
  raceId: number;
  trackId: number;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
            Help The Model
          </p>
          <h2 className="mt-1 text-base font-bold text-white">Where To Put What You Know</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Use the smallest structured input that fits. Notes explain; caveats protect one race; features help future races.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/races/${raceId}`}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:text-white"
          >
            Race Hub
          </Link>
          <Link
            href={`/admin/tracks/${trackId}`}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:text-white"
          >
            Track Intel
          </Link>
        </div>
      </div>

      <div className="grid gap-px bg-[var(--border)] lg:grid-cols-2">
        {directions.map((item) => (
          <div key={item.signal} className="bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-white">{item.signal}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-amber-300">
                  {item.where}
                </p>
              </div>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 font-mono text-[10px] font-bold text-slate-300">
                {item.weight}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.action}</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              <span className="font-semibold text-slate-300">Example:</span> {item.example}
            </p>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--surface-raised)] px-5 py-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Score delta scale</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          {scale.map((item) => (
            <div key={item.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              <p className="text-xs font-bold text-white">{item.label}</p>
              <p className="mt-1 font-mono text-[11px] font-bold text-amber-300">{item.value}</p>
              <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
