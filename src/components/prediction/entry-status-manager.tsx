"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateEntryStatusAction } from "@/app/actions";
import type { RaceEntry } from "@/lib/races";

type EntryStatus = RaceEntry["entry_status"];

type EntryStatusRow = {
  driverId: number;
  driverName: string;
  carNumber: string | null;
  entryStatus: EntryStatus;
};

const labels: Record<EntryStatus, string> = {
  confirmed: "Confirmed",
  expected: "Expected",
  unconfirmed: "Unconfirmed",
  scratched: "Scratched",
};

function statusClass(status: EntryStatus) {
  if (status === "confirmed") return "text-green-300";
  if (status === "unconfirmed") return "text-amber-300";
  if (status === "scratched") return "text-red-300";
  return "text-[var(--muted)]";
}

export function EntryStatusManager({
  raceId,
  entries,
}: {
  raceId: number;
  entries: EntryStatusRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function update(driverId: number, entryStatus: EntryStatus) {
    setStatus("Saving entry status...");
    startTransition(async () => {
      const result = await updateEntryStatusAction({ raceId, driverId, entryStatus });
      if (result.error) {
        setStatus(result.error);
        return;
      }

      setStatus("Entry status saved. Write odds again to publish updated prices.");
      router.refresh();
    });
  }

  const risky = entries.filter((entry) => ["unconfirmed", "scratched"].includes(entry.entryStatus));

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white">Entry Status</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Confirm who is actually there before publishing odds. Unconfirmed and scratched entries adjust the prediction card.
          </p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${risky.length ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-green-500/30 bg-green-500/10 text-green-300"}`}>
          {risky.length ? `${risky.length} watch` : "clean"}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <div key={entry.driverId} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">
                {entry.driverName}
                {entry.carNumber ? <span className="ml-1 font-mono text-[var(--muted)]">#{entry.carNumber}</span> : null}
              </p>
              <p className={`mt-0.5 text-[10px] font-bold uppercase tracking-wider ${statusClass(entry.entryStatus)}`}>
                {labels[entry.entryStatus]}
              </p>
            </div>
            <select
              value={entry.entryStatus}
              onChange={(event) => update(entry.driverId, event.target.value as EntryStatus)}
              disabled={isPending}
              className="w-32 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--accent)] disabled:opacity-60"
            >
              <option value="confirmed">Confirmed</option>
              <option value="expected">Expected</option>
              <option value="unconfirmed">Unconfirmed</option>
              <option value="scratched">Scratched</option>
            </select>
          </div>
        ))}
      </div>

      {status ? <p className="mt-3 text-xs font-semibold text-amber-300">{status}</p> : null}
    </section>
  );
}
