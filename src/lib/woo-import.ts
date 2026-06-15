import "server-only";
import { getDb } from "./db";

// ── Recaps list ───────────────────────────────────────────────────────────────

export type WooEventSummary = {
  event_id: string;
  name: string;
  track: string;
  date: string;
  series: string;
  results_url: string;
};

export async function fetchWooRecaps(series = "latemodels"): Promise<WooEventSummary[]> {
  const url = `https://worldofoutlaws.com/recaps/?series=${series}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Recaps returned HTTP ${res.status}`);
  const html = await res.text();
  return parseRecapsList(html, series);
}

function parseRecapsList(html: string, series: string): WooEventSummary[] {
  const events: WooEventSummary[] = [];
  // Match all links to results pages: /results/?event=XXXXXX&series=...
  const linkRegex = /href="(\/results\/\?event=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    const href = m[1];
    const event_id = m[2];
    const linkText = stripHtml(m[3]);
    if (!linkText || events.find((e) => e.event_id === event_id)) continue;
    // Skip non-latemodels links when filtering
    if (series === "latemodels" && href.includes("series=") && !href.includes("latemodels")) continue;
    events.push({
      event_id,
      name: linkText,
      track: "",
      date: "",
      series: "WoO Late Models",
      results_url: `https://worldofoutlaws.com${href}`,
    });
  }

  // Also try to find event cards with more structured data
  // <article> or <div class="...recap..."> blocks
  const cardRegex = /<(?:article|div)[^>]*class="[^"]*(?:recap|event|result)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
  while ((m = cardRegex.exec(html)) !== null) {
    const block = m[1];
    const idM = block.match(/event=(\d+)/);
    if (!idM) continue;
    const event_id = idM[1];
    if (events.find((e) => e.event_id === event_id)) continue;
    const nameM = block.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
    const dateM = block.match(/(\w+ \d{1,2},?\s*\d{4})/);
    const trackM = block.match(/(?:at|@)\s+([A-Z][^<\n,]+)/);
    events.push({
      event_id,
      name: nameM ? stripHtml(nameM[1]) : `Event ${event_id}`,
      track: trackM ? trackM[1].trim() : "",
      date: dateM ? dateM[1] : "",
      series: "WoO Late Models",
      results_url: `https://worldofoutlaws.com/results/?event=${event_id}&series=${series}`,
    });
  }

  return events;
}

export type ParsedEntry = {
  finishing_position: number;
  starting_position: number | null;
  car_number: string;
  driver_name: string;
  qualifying_time: number | null;
  heat_position: number | null;
  laps_led: number;
  dnf: boolean;
  status: string;
};

export type ParsedEvent = {
  event_name: string;
  track_name: string;
  date: string;
  entries: ParsedEntry[];
};

export type ImportResult = {
  event: ParsedEvent;
  matched: number;
  created: number;
  updated: number;
  warnings: string[];
};

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseHeatPosition(s: string): number | null {
  if (!s) return null;
  if (/win/i.test(s)) return 1;
  const m = s.match(/(\d+)(?:st|nd|rd|th)/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseQualTime(s: string): number | null {
  const m = s.match(/(\d+\.\d+)/);
  return m ? parseFloat(m[1]) : null;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// Parse an HTML <table> of WoO results into entry objects
function parseResultsTable(html: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];

  // Extract all <tr> rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];

    // Extract <td> cells
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(stripHtml(cellMatch[1]));
    }

    // Expect at least 9 columns: Fin Start +/- # Driver Q-Time Heat Laps-Led Status
    if (cells.length < 9) continue;
    const fin = parseInt(cells[0], 10);
    if (isNaN(fin)) continue; // skip header rows

    const start = parseInt(cells[1], 10);
    const carNum = cells[3].trim();
    const driverName = cells[4].trim();
    const qtStr = cells[5];
    const heatStr = cells[6];
    const lapsLed = parseInt(cells[7], 10) || 0;
    const status = cells[8].trim();

    entries.push({
      finishing_position: fin,
      starting_position: isNaN(start) ? null : start,
      car_number: carNum,
      driver_name: driverName,
      qualifying_time: parseQualTime(qtStr),
      heat_position: parseHeatPosition(heatStr),
      laps_led: lapsLed,
      dnf: !/^running$/i.test(status),
      status,
    });
  }

  return entries;
}

// Extract event metadata (name, track, date) from page HTML
function parseEventMeta(html: string): Omit<ParsedEvent, "entries"> {
  // Try <title> or <h1> for event name
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) ?? html.match(/<title>([^<|]+)/i);
  const event_name = titleMatch ? stripHtml(titleMatch[1]) : "WoO Event";

  // Track — look for common patterns
  const trackMatch = html.match(/Track[:\s]+([^<\n,]+)/i) ?? html.match(/<[^>]*class="[^"]*track[^"]*"[^>]*>([^<]+)/i);
  const track_name = trackMatch ? stripHtml(trackMatch[1]) : "";

  // Date
  const dateMatch = html.match(/(\w+ \d{1,2},\s*\d{4})/);
  const date = dateMatch ? dateMatch[1] : "";

  return { event_name, track_name, date };
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

export function extractEventId(urlOrId: string): string {
  const m = urlOrId.match(/event=(\d+)/);
  return m ? m[1] : urlOrId.trim();
}

export async function fetchWooHtml(eventId: string): Promise<string> {
  const url = `https://worldofoutlaws.com/results/?event=${eventId}&series=latemodels`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`WoO returned HTTP ${res.status}`);
  return res.text();
}

export function parseWooHtml(html: string): ParsedEvent {
  const meta = parseEventMeta(html);
  const entries = parseResultsTable(html);
  return { ...meta, entries };
}

// ── Name matching ─────────────────────────────────────────────────────────────

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function findDriverId(name: string, drivers: Array<{ id: number; name: string }>): number | null {
  const norm = normalizeName(name);
  // Exact normalized match
  for (const d of drivers) {
    if (normalizeName(d.name) === norm) return d.id;
  }
  // Partial: last name match
  const lastName = norm.split(" ").pop() ?? "";
  const firstLetter = norm[0] ?? "";
  for (const d of drivers) {
    const dn = normalizeName(d.name);
    if (dn.split(" ").pop() === lastName && dn[0] === firstLetter) return d.id;
  }
  return null;
}

// ── DB import ─────────────────────────────────────────────────────────────────

// ── WoO Series Points standings importer ────────────────────────────────────

export type StandingsEntry = {
  pos: number;
  car_number: string;
  driver_name: string;
  hometown: string;
  points: number;
  starts: number;
  wins: number;
  top5: number;
  top10: number;
};

export type StandingsImportResult = {
  season: number;
  total: number;
  created: number;
  matched: number;
  warnings: string[];
};

export async function fetchWooStandings(season: number): Promise<StandingsEntry[]> {
  const url = `https://worldofoutlaws.com/series-points/?series=latemodels&season=${season}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`WoO standings returned HTTP ${res.status}`);
  const html = await res.text();
  return parseStandingsHtml(html);
}

function parseStandingsHtml(html: string): StandingsEntry[] {
  const entries: StandingsEntry[] = [];

  // Find the main standings table rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(stripHtml(cellMatch[1]).trim());
    }

    // Columns: Pos | No. | Driver | Hometown | Points | Gap | Starts | Wins | Top5s | Top10s
    if (cells.length < 10) continue;

    const pos = parseInt(cells[0], 10);
    if (isNaN(pos) || pos < 1) continue;

    const carNum = cells[1];
    const driverName = cells[2];
    const hometown = cells[3];
    const points = parseInt(cells[4].replace(/,/g, ""), 10) || 0;
    // cells[5] = Gap (skip)
    const starts = parseInt(cells[6], 10) || 0;
    const wins = parseInt(cells[7], 10) || 0;
    const top5 = parseInt(cells[8], 10) || 0;
    const top10 = parseInt(cells[9], 10) || 0;

    if (!driverName || driverName.length < 2) continue;

    entries.push({ pos, car_number: carNum, driver_name: driverName, hometown, points, starts, wins, top5, top10 });
  }

  return entries;
}

export function importWooStandings(season: number, entries: StandingsEntry[]): StandingsImportResult {
  const db = getDb();
  const warnings: string[] = [];
  let created = 0, matched = 0;

  const allDrivers = db.prepare("SELECT id, name, hometown FROM drivers").all() as Array<{ id: number; name: string; hometown: string | null }>;

  for (const entry of entries) {
    let driverId = findDriverId(entry.driver_name, allDrivers);

    if (!driverId) {
      const r = db.prepare(
        `INSERT INTO drivers (name, car_number, division, hometown) VALUES (?, ?, 'WoO Late Models', ?)`
      ).run(entry.driver_name, entry.car_number || null, entry.hometown || null);
      driverId = r.lastInsertRowid as number;
      allDrivers.push({ id: driverId, name: entry.driver_name, hometown: entry.hometown || null });
      created++;
    } else {
      // Update car number and hometown if missing
      db.prepare(`UPDATE drivers SET car_number = COALESCE(car_number, ?), hometown = COALESCE(hometown, ?) WHERE id = ?`)
        .run(entry.car_number || null, entry.hometown || null, driverId);
      matched++;
    }

    // Upsert season stats
    db.prepare(`
      INSERT INTO driver_season_stats (driver_id, season, series, starts, wins, top5, top10, points_pos)
      VALUES (?, ?, 'WoO Late Models', ?, ?, ?, ?, ?)
      ON CONFLICT(driver_id, season, series) DO UPDATE SET
        starts = excluded.starts,
        wins = excluded.wins,
        top5 = excluded.top5,
        top10 = excluded.top10,
        points_pos = excluded.points_pos
    `).run(driverId, season, entry.starts, entry.wins, entry.top5, entry.top10, entry.pos);
  }

  if (entries.length === 0) warnings.push("No entries found — the page may use JavaScript rendering");

  return { season, total: entries.length, created, matched, warnings };
}

// ── WoO event results importer ────────────────────────────────────────────────

export function importWooResults(raceId: number, event: ParsedEvent): ImportResult {
  const db = getDb();
  const warnings: string[] = [];
  let matched = 0, created = 0, updated = 0;

  // Load all existing drivers once
  const allDrivers = db.prepare("SELECT id, name FROM drivers").all() as Array<{ id: number; name: string }>;

  for (const entry of event.entries) {
    let driverId = findDriverId(entry.driver_name, allDrivers);

    if (!driverId) {
      // Create the driver
      const r = db.prepare(
        `INSERT INTO drivers (name, car_number, division) VALUES (?, ?, 'WoO Late Models')`
      ).run(entry.driver_name, entry.car_number || null);
      driverId = r.lastInsertRowid as number;
      allDrivers.push({ id: driverId, name: entry.driver_name });
      created++;
      warnings.push(`Created new driver: ${entry.driver_name}`);
    } else {
      matched++;
    }

    // Upsert the race entry — update all fields if the row already exists
    const existing = db.prepare(
      "SELECT id FROM race_entries WHERE race_id = ? AND driver_id = ?"
    ).get(raceId, driverId);

    if (existing) {
      db.prepare(`
        UPDATE race_entries
        SET car_number = ?, starting_position = ?, qualifying_time = ?,
            heat_position = ?, finishing_position = ?, laps_led = ?, dnf = ?
        WHERE race_id = ? AND driver_id = ?
      `).run(
        entry.car_number || null,
        entry.starting_position ?? null,
        entry.qualifying_time ?? null,
        entry.heat_position ?? null,
        entry.finishing_position,
        entry.laps_led,
        entry.dnf ? 1 : 0,
        raceId, driverId
      );
      updated++;
    } else {
      db.prepare(`
        INSERT INTO race_entries
          (race_id, driver_id, car_number, starting_position, qualifying_time,
           heat_position, finishing_position, laps_led, dnf)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        raceId, driverId,
        entry.car_number || null,
        entry.starting_position ?? null,
        entry.qualifying_time ?? null,
        entry.heat_position ?? null,
        entry.finishing_position,
        entry.laps_led,
        entry.dnf ? 1 : 0
      );
      updated++;
    }
  }

  // Mark the race complete if we have results
  if (event.entries.length > 0) {
    db.prepare("UPDATE races SET status = 'complete' WHERE id = ?").run(raceId);
    // Settle any open bets
    const winner = event.entries.find((e) => e.finishing_position === 1 && !e.dnf);
    if (winner) {
      const wId = findDriverId(winner.driver_name, allDrivers);
      if (wId) {
        db.prepare("UPDATE bets SET status = 'won' WHERE race_id = ? AND driver_id = ? AND status = 'open'").run(raceId, wId);
        db.prepare("UPDATE bets SET status = 'lost' WHERE race_id = ? AND driver_id != ? AND status = 'open'").run(raceId, wId);
      }
    }
  }

  return { event, matched, created, updated, warnings };
}
