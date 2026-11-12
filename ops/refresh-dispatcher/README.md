# Hourly refresh dispatcher

Cloudflare Workers Cron calls GitHub workflow_dispatch for sports-refresh.yml and
world100-refresh.yml at minute 17 of every hour, UTC, with ref main. No machine must
stay on. Existing GitHub cron entries remain fallback triggers. GitHub scheduling is
best-effort; on November 12 its active workflows showed missing hourly runs with no
queued or running job to explain them. The API does not expose the root cause.

## Owner setup (required; not activated by committing this directory)

1. Sign into or create a Cloudflare account with Workers enabled.
2. On GitHub, Settings → Developer settings → Personal access tokens → Fine-grained
   tokens → Generate new token. Resource owner: Mullins-Creative-Co. Select only
   dirtiq. Repository permissions: Actions **read and write** (Metadata read is
   implicit). Choose an expiry and record a renewal reminder. Obtain organization
   approval if GitHub requires it. Do not put this token into chat or a file.
3. In this directory, run `npx wrangler@4 login`.
4. Run `npx wrangler@4 secret put GITHUB_DISPATCH_TOKEN` and paste the token at its
   hidden prompt. If asked to create the Worker, accept.
5. Run `npx wrangler@4 deploy`. Verify Cloudflare shows cron `17 * * * *` and the
   GITHUB_DISPATCH_TOKEN secret. Cron changes can take several minutes to propagate.
6. Inspect Worker logs (`npx wrangler@4 tail`) after two consecutive hourly ticks.
   Each tick must log successful dispatches for both workflows. HTTP 204 proves
   acceptance only, not workflow completion. On 401/403, renew the scoped token or
   obtain organization approval. No response bodies or tokens are logged.
7. Run `gh run list --workflow sports-refresh.yml --event workflow_dispatch --limit 6
   --json databaseId,createdAt,status,conclusion`. Confirm two successful runs one
   hour apart, matching the Worker logs. Check the racing workflow too.
8. Confirm daily-card.json on main is younger than 75 minutes and the protected
   production `/api/freshness` and pages reflect that commit. Review errors separately
   from dispatch acceptance. Configure Cloudflare notification preferences if desired.

No account or credential was created automatically. Until steps 1–5 are completed,
external scheduling is **not active**. A temporary local loop is not a replacement.

## Quota and reliability

Sports dispatch does not force Odds API snapshots. Only the existing persisted DUE
slot check (00:00 and 18:00 UTC) permits them. Do not clear odds/status.json or bypass
that gate. Fallback cron can cause extra forecasts; concurrency serializes each
workflow, and later checkouts see the persisted odds slot. If a run dies before
publishing its slot marker, an attempt can repeat; this pre-existing failure case is
not a strict quota reservation. There is no manual force option.

GitHub and Cloudflare can both fail; the dispatcher removes dependence on GitHub
cron, not dependence on Actions itself. Page-load checks query GitHub's public Actions
API with no token; rate limits or network failures are shown as "not verified".
Artifact age detects missed triggers even when no failed run exists. `/api/freshness`
reports deployment-local artifacts, so a successful bot followed by a failed Vercel
deploy still shows overdue data. Ages are computed at request time, not frozen in JSON.

Run `node --test worker.test.mjs` for mocked dispatch contract checks. These tests do
not prove any real scheduler tick or GitHub run occurred.
