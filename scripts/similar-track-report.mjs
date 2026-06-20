import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const dbPath = process.env.DIRTIQ_DB ?? join(process.cwd(), "data/dirtiq.db");
const db = new DatabaseSync(dbPath);

const targetTrackName = process.argv[2] ?? "Smoky Mountain Speedway";
const minStarts = Number(process.argv[3] ?? 1);

const targetTrack = db
  .prepare("SELECT id, name FROM tracks WHERE name = ? COLLATE NOCASE")
  .get(targetTrackName);

if (!targetTrack) {
  console.error(`Track not found: ${targetTrackName}`);
  process.exit(1);
}

const tracks = db
  .prepare(
    `SELECT t.id, t.name, t.location, t.track_length, t.banking_angle, 1.0 AS similarity_weight, 'target' AS notes
     FROM tracks t
     WHERE t.id = ?
     UNION ALL
     SELECT t.id, t.name, t.location, t.track_length, t.banking_angle, ts.similarity_weight, ts.notes
     FROM track_similars ts
     JOIN tracks t ON t.id = CASE WHEN ts.track_id = ? THEN ts.similar_track_id ELSE ts.track_id END
     WHERE ts.track_id = ? OR ts.similar_track_id = ?
     ORDER BY similarity_weight DESC, name`
  )
  .all(targetTrack.id, targetTrack.id, targetTrack.id, targetTrack.id);

const trackIds = tracks.map((track) => track.id);
const placeholders = trackIds.map(() => "?").join(",");

const winners = db
  .prepare(
    `SELECT r.race_date, t.name AS track_name, r.name AS race_name,
            COALESCE(NULLIF(r.series_mode, ''), r.division, 'Open') AS series,
            CASE
              WHEN lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) LIKE '%lucas%' THEN 'sanctioned'
              WHEN lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) LIKE '%woo%' THEN 'sanctioned'
              WHEN lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) LIKE '%world of outlaws%' THEN 'sanctioned'
              ELSE 'unsanctioned/open'
            END AS sanction_bucket,
            d.name AS winner
     FROM race_entries re
     JOIN races r ON r.id = re.race_id
     JOIN tracks t ON t.id = r.track_id
     JOIN drivers d ON d.id = re.driver_id
     WHERE r.status = 'complete'
       AND r.track_id IN (${placeholders})
       AND re.finishing_position = 1
     ORDER BY r.race_date DESC, t.name`
  )
  .all(...trackIds);

const driverSummary = db
  .prepare(
    `SELECT d.name AS driver_name,
            COUNT(*) AS starts,
            SUM(CASE WHEN re.finishing_position = 1 THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN re.finishing_position <= 3 THEN 1 ELSE 0 END) AS top3,
            SUM(CASE WHEN re.finishing_position <= 5 THEN 1 ELSE 0 END) AS top5,
            ROUND(AVG(CAST(re.finishing_position AS REAL)), 2) AS avg_finish,
            ROUND(SUM(CASE WHEN re.finishing_position = 1 THEN tw.weight ELSE 0 END), 2) AS weighted_wins,
            ROUND(SUM(tw.weight), 2) AS weighted_starts
     FROM race_entries re
     JOIN races r ON r.id = re.race_id
     JOIN drivers d ON d.id = re.driver_id
     JOIN (
       SELECT ? AS track_id, 1.0 AS weight
       UNION ALL
       SELECT CASE WHEN track_id = ? THEN similar_track_id ELSE track_id END AS track_id,
              similarity_weight AS weight
       FROM track_similars
       WHERE track_id = ? OR similar_track_id = ?
     ) tw ON tw.track_id = r.track_id
     WHERE r.status = 'complete'
       AND r.track_id IN (${placeholders})
       AND re.finishing_position IS NOT NULL
     GROUP BY d.id
     HAVING starts >= ?
     ORDER BY weighted_wins DESC, wins DESC, top3 DESC, avg_finish ASC
     LIMIT 40`
  )
  .all(targetTrack.id, targetTrack.id, targetTrack.id, targetTrack.id, ...trackIds, minStarts);

console.log(`\nSimilar-track report: ${targetTrack.name}`);
console.log("\nTrack set");
for (const track of tracks) {
  console.log(
    `- ${track.name} | ${track.location ?? "unknown"} | ${track.track_length ?? "?"} mi | banking ${track.banking_angle ?? "?"} | weight ${Number(track.similarity_weight).toFixed(2)}`
  );
}

console.log("\nWinner history");
for (const row of winners) {
  console.log(`${row.race_date} | ${row.track_name} | ${row.sanction_bucket} | ${row.series} | ${row.winner} | ${row.race_name}`);
}

console.log("\nDriver trend summary");
for (const row of driverSummary) {
  console.log(
    `${row.driver_name} | starts ${row.starts} | wins ${row.wins} | top3 ${row.top3} | top5 ${row.top5} | avg ${row.avg_finish} | weighted wins ${row.weighted_wins}/${row.weighted_starts}`
  );
}
