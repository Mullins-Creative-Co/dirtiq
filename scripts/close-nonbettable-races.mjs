import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2] ?? "data/dirtiq.db";
const db = new DatabaseSync(dbPath);

const today = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
  .formatToParts(new Date())
  .reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});

const todayDate = `${today.year}-${today.month}-${today.day}`;

db.exec("BEGIN");
try {
  const completed = db.prepare(`
    UPDATE races
    SET betting_status = 'settled',
        is_live = 0,
        betting_locked_at = COALESCE(betting_locked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        betting_lock_reason = COALESCE(betting_lock_reason, 'race complete'),
        settled_at = COALESCE(settled_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE status = 'complete'
      AND betting_status != 'settled'
  `).run();

  const pastUpcoming = db.prepare(`
    UPDATE races
    SET betting_status = 'locked',
        is_live = 0,
        betting_locked_at = COALESCE(betting_locked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        betting_lock_reason = COALESCE(betting_lock_reason, 'race date passed')
    WHERE status = 'upcoming'
      AND race_date < ?
      AND betting_status = 'open'
  `).run(todayDate);

  const nonLateModel = db.prepare(`
    UPDATE races
    SET betting_status = 'locked',
        betting_locked_at = COALESCE(betting_locked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        betting_lock_reason = COALESCE(betting_lock_reason, 'not a late model betting division')
    WHERE status = 'upcoming'
      AND race_date >= ?
      AND betting_status = 'open'
      AND lower(COALESCE(division, '')) NOT LIKE '%late model%'
      AND lower(COALESCE(division, '')) NOT LIKE '%lucas oil lmds%'
      AND lower(COALESCE(division, '')) NOT LIKE '%crown jewel%'
  `).run(todayDate);

  db.exec("COMMIT");
  db.exec("VACUUM");
  console.log(
    `Updated ${dbPath}: ${completed.changes} completed settled, ${pastUpcoming.changes} past upcoming locked, ${nonLateModel.changes} non-late-model upcoming locked.`
  );
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
