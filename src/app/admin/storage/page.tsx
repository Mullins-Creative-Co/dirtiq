import { connection } from "next/server";
import Link from "next/link";

import { Nav } from "@/components/nav";
import { StorageVerifyPanel } from "@/components/storage-verify-panel";
import { getStorageStatus } from "@/lib/storage-status";

function statusTone(ok: boolean) {
  return ok
    ? "border-green-500/35 bg-green-500/10 text-green-300"
    : "border-amber-500/40 bg-amber-500/10 text-amber-200";
}

export default async function AdminStoragePage() {
  await connection();
  const storage = getStorageStatus();
  const publicBetsDurable = storage.publicBetStore === "neon";
  const raceDataDurable = !storage.needsHostedRaceStore;

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <Nav />
      <main className="mx-auto max-w-5xl space-y-5 px-3 pb-24 pt-4 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/admin/live" className="text-xs font-bold text-[var(--muted)] hover:text-white">
              Back to live
            </Link>
            <h1 className="mt-2 text-2xl font-black uppercase text-white">Storage Status</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              This page tells you what survives deploys and phone updates. Public betting can use Neon now;
              race/admin state still needs a larger database migration before it is fully durable.
            </p>
          </div>
          <span className={`border px-3 py-2 text-xs font-black uppercase tracking-widest ${statusTone(publicBetsDurable)}`}>
            {publicBetsDurable ? "Betting Durable" : "Needs Database URL"}
          </span>
        </div>

        <section className="grid gap-px border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
          {[
            ["Runtime", storage.runtime === "vercel" ? "Production" : "Local", storage.runtime],
            ["Race/admin data", raceDataDurable ? "Durable" : "Temporary SQLite", storage.raceStore],
            ["Public bet accounts", publicBetsDurable ? "Neon" : "SQLite", storage.publicBetStore],
          ].map(([label, value, detail]) => (
            <div key={label} className="bg-[var(--surface)] px-4 py-4">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--muted)]">{label}</p>
              <p className="mt-2 text-lg font-black text-white">{value}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{detail}</p>
            </div>
          ))}
        </section>

        <section className={`border px-4 py-4 ${statusTone(publicBetsDurable)}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Current source of truth</p>
          <p className="mt-2 text-sm font-bold text-white">{storage.summary}</p>
          <p className="mt-2 text-xs leading-5 opacity-90">
            SQLite path: <span className="font-mono">{storage.databasePath}</span>
          </p>
        </section>

        <StorageVerifyPanel />

        <section className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-black uppercase tracking-[0.16em] text-white">Race Admin Snapshot</h2>
          </div>
          <div className="space-y-3 p-4">
            <p className="text-sm leading-6 text-[var(--muted)]">
              Download the current operational state for races, entries, caveats, market lines, model reviews,
              track notes, and driver profiles. This does not export friend betting accounts or wagers.
            </p>
            <a
              href="/api/storage/export"
              className="inline-flex w-full justify-center bg-[var(--accent)] px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-white sm:w-auto"
            >
              Download Snapshot
            </a>
            <p className="text-xs leading-5 text-[var(--muted)]">
              Use this as a safety backup while production race/admin data is still temporary SQLite.
            </p>
          </div>
        </section>

        <section className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-black uppercase tracking-[0.16em] text-white">Next Durable Step</h2>
          </div>
          <div className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["1", "Create Neon", "Add a Neon Postgres database through Vercel Marketplace or Neon."],
                ["2", "Add env var", "Set DATABASE_URL for Production, Preview, and Development in Vercel."],
                ["3", "Redeploy", "After redeploy, this page should show public bets as Neon."],
              ].map(([number, title, body]) => (
                <div key={number} className="border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-4">
                  <p className="text-2xl font-black text-[var(--accent)]">{number}</p>
                  <p className="mt-1 text-sm font-black text-white">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{body}</p>
                </div>
              ))}
            </div>

            <div className="border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--muted)]">CLI fallback</p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded bg-black/30 p-3 text-xs leading-5 text-slate-200">
{`vercel env add DATABASE_URL production
vercel env add DATABASE_URL preview
vercel env add DATABASE_URL development
vercel --prod --yes
vercel env ls`}
              </pre>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                Paste the Neon pooled connection string when the CLI prompts for the value. Do not commit that URL to the repo.
              </p>
            </div>
          </div>
        </section>

        <section className="border border-blue-500/30 bg-blue-500/10 px-4 py-4">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-200">Important</p>
          <p className="mt-2 text-sm leading-6 text-slate-200">
            Adding <span className="font-mono">DATABASE_URL</span> makes friend accounts and public bets durable.
            The full model/race/admin database is still SQLite and needs a separate migration plan before every field,
            caveat, result, and race status is hosted in Postgres.
          </p>
        </section>
      </main>
    </div>
  );
}
