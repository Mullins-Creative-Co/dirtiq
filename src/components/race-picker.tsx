"use client";
import { useRouter } from "next/navigation";

type Race = {
  id: number;
  name: string;
  race_date: string;
  track_name: string;
  status: string;
};

export function RacePicker({
  races,
  selectedId,
}: {
  races: Race[];
  selectedId: number | null;
}) {
  const router = useRouter();

  if (races.length === 0) return null;

  const upcoming = races.filter((r) => r.status === "upcoming");
  const completed = races.filter((r) => r.status === "complete");

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val) router.push(`/model?race=${val}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={selectedId ?? ""}
        onChange={handleChange}
        className="flex-1 max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
      >
        <option value="">— Pick a race —</option>
        {upcoming.length > 0 && (
          <optgroup label="Upcoming">
            {upcoming.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.track_name} · {r.race_date}
              </option>
            ))}
          </optgroup>
        )}
        {completed.length > 0 && (
          <optgroup label="Completed">
            {completed.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.track_name} · {r.race_date}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {selectedId && (
        <button
          onClick={() => router.push("/model")}
          className="text-xs text-[var(--muted)] hover:text-white border border-[var(--border)] rounded-lg px-3 py-2.5 transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
