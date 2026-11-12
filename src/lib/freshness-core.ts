export function artifactAge(timestamp: string | null | undefined, now = Date.now()) {
  const parsed = timestamp ? Date.parse(timestamp) : NaN;
  const ageMinutes = Number.isFinite(parsed) && parsed <= now ? (now - parsed) / 60_000 : null;
  return { timestamp: timestamp ?? null, ageMinutes, stale: ageMinutes === null || ageMinutes > 180, overdue: ageMinutes === null || ageMinutes > 75 };
}
