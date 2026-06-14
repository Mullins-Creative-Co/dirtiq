import "server-only";

export type MrpSessionType = "qualifying" | "heat" | "bmain" | "feature" | "unknown";

export type MrpSessionEntry = {
  driver_name: string;
  car_number: string | null;
  position: number;
  time: number | null;   // qualifying time in seconds
  dnf: boolean;
};

export type MrpSession = {
  name: string;
  type: MrpSessionType;
  entries: MrpSessionEntry[];
};

export type MrpLineupEntry = {
  driver_name: string;
  car_number: string | null;
  qualifying_time: number | null;
  heat_position: number | null;    // best heat finish
  starting_position: number | null; // feature grid position
};

export type MrpLineupResult = {
  event_name: string;
  sessions: MrpSession[];
  entries: MrpLineupEntry[];
  warnings: string[];
};

// ── HTML helpers ──────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function classifySession(name: string): MrpSessionType {
  const l = name.toLowerCase();
  if (/qualif|time.?trial|\bqt\b/.test(l)) return "qualifying";
  if (/\bb.?main\b|\bb.?feat|\bconsolation\b/.test(l)) return "bmain";
  if (/\bheat\b|\bprelim/.test(l)) return "heat";
  if (/\ba.?feat|\bfeature\b|\bmain.?event\b|\bfeature\b/.test(l)) return "feature";
  return "unknown";
}

// Given column header strings, find the index that best matches a target pattern
function colIdx(headers: string[], pattern: RegExp): number {
  return headers.findIndex((h) => pattern.test(h.toLowerCase()));
}

function parseResultTable(headers: string[], rows: string[][]): MrpSessionEntry[] {
  // Flexible column detection
  const finIdx = colIdx(headers, /^finish$|^fin$|^pos$|^position$|^start.*pos/);
  const carIdx = colIdx(headers, /^#$|^car/);
  const nameIdx = colIdx(headers, /compet|driver|name/);
  const timeIdx = colIdx(headers, /time/);

  const results: MrpSessionEntry[] = [];
  const seen = new Set<string>();

  for (const cells of rows) {
    if (cells.length < 2) continue;

    const rawPos = cells[finIdx >= 0 ? finIdx : 0] ?? "";
    const isDnf = /dnf|dns/i.test(rawPos);
    const pos = parseInt(rawPos, 10);
    if (isNaN(pos) || pos < 1) continue;

    // Driver name: prefer detected column, fall back to scanning
    let driverRaw = "";
    if (nameIdx >= 0) {
      driverRaw = cells[nameIdx];
    } else {
      // Find longest cell that looks like a name (letters, no lone digits)
      driverRaw = cells.find((c) => /^[A-Za-z]/.test(c) && c.length > 3) ?? "";
    }
    const driver = driverRaw.split(/\r?\n/)[0].trim();
    if (!driver || driver.length < 2) continue;

    const carNum = carIdx >= 0 ? (cells[carIdx] || null) : null;

    let time: number | null = null;
    if (timeIdx >= 0) {
      const t = parseFloat(cells[timeIdx]);
      if (!isNaN(t) && t > 0) time = t;
    }

    const key = `${pos}|${driver}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({ driver_name: driver, car_number: carNum?.trim() || null, position: pos, time, dnf: isDnf });
  }

  return results;
}

// ── Main page parser ──────────────────────────────────────────────────────────

export function parseMrpEventPage(html: string): { event_name: string; sessions: MrpSession[] } {
  const sessions: MrpSession[] = [];

  // Event name from <title> or first <h1>
  const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const h1M = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const event_name = stripTags(h1M?.[1] ?? titleM?.[1] ?? "").replace(/\s*[-|]\s*MyRacePass.*$/i, "").trim();

  // Strategy 1: find section blocks — look for heading elements followed by tables
  // We'll scan for all <h1>-<h6> tags, then find the next <table> within range
  const sectionRegex = /<(h[1-6]|div[^>]+(?:card-header|session-name|race-title)[^>]*)[^>]*>([\s\S]*?)<\/\1>/gi;
  const tableRegex = /<table[\s\S]*?<\/table>/gi;

  // Collect all table positions in the HTML
  const tables: Array<{ start: number; end: number; html: string }> = [];
  let tm: RegExpExecArray | null;
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  while ((tm = tableRe.exec(html)) !== null) {
    tables.push({ start: tm.index, end: tm.index + tm[0].length, html: tm[0] });
  }

  // Collect all heading positions
  const headings: Array<{ start: number; text: string }> = [];
  const headingRe = /<(?:h[1-6]|div[^>]+(?:card-header|panel-title|race-name|section-title)[^>]*?)>([\s\S]*?)<\/(?:h[1-6]|div)>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(html)) !== null) {
    const text = stripTags(hm[1]);
    if (text.length > 1 && text.length < 120) {
      headings.push({ start: hm.index, text });
    }
  }

  // For each table, find the closest preceding heading
  for (const table of tables) {
    // Find nearest heading BEFORE this table (within 4000 chars)
    const preceding = headings
      .filter((h) => h.start < table.start && table.start - h.start < 4000)
      .sort((a, b) => b.start - a.start)[0];

    const sessionName = preceding?.text ?? "";

    // Parse header row
    const thMatches = [...table.html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
    const headers = thMatches.map((m) => stripTags(m[1]));
    if (headers.length < 2) continue;

    // Check this looks like a results table
    const hasPositionCol = headers.some((h) => /finish|pos|start|rank/i.test(h));
    const hasNameCol = headers.some((h) => /compet|driver|name|#/i.test(h));
    if (!hasPositionCol && !hasNameCol) continue;

    // Parse data rows
    const tbody = table.html.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? table.html;
    const rowMatches = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    const rows = rowMatches.map((r) => {
      const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      return cells.map((c) => stripTags(c[1]));
    }).filter((r) => r.length >= 2);

    const entries = parseResultTable(headers, rows);
    if (entries.length === 0) continue;

    const type = classifySession(sessionName);

    // Avoid duplicate sessions (same name+type)
    const existing = sessions.find((s) => s.name === sessionName && s.type === type);
    if (existing) {
      // Merge if same session appears in multiple tables
      existing.entries.push(...entries.filter((e) =>
        !existing.entries.some((x) => x.driver_name === e.driver_name)
      ));
    } else {
      sessions.push({ name: sessionName || `Session ${sessions.length + 1}`, type, entries });
    }
  }

  // Strategy 2 fallback — if no sections found, try parsing all tables generically
  if (sessions.length === 0) {
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      const thMatches = [...table.html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
      const headers = thMatches.map((m) => stripTags(m[1]));
      if (headers.length < 2) continue;

      const tbody = table.html.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? table.html;
      const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1])))
        .filter((r) => r.length >= 2);

      const entries = parseResultTable(headers, rows);
      if (entries.length === 0) continue;

      // Guess session type from headers
      const headerStr = headers.join(" ").toLowerCase();
      let type: MrpSessionType = "unknown";
      if (/time/.test(headerStr) && !/finish/.test(headerStr)) type = "qualifying";
      else if (/finish/.test(headerStr)) type = "heat"; // generic race result

      sessions.push({ name: `Session ${i + 1}`, type, entries });
    }
  }

  return { event_name, sessions };
}

// ── Merge sessions into per-driver lineup entries ────────────────────────────

export function mergeSessions(sessions: MrpSession[]): MrpLineupEntry[] {
  const map = new Map<string, MrpLineupEntry>();

  const normName = (n: string) => n.toLowerCase().trim();

  function getOrCreate(name: string, carNum: string | null): MrpLineupEntry {
    const key = normName(name);
    if (!map.has(key)) {
      map.set(key, {
        driver_name: name,
        car_number: carNum,
        qualifying_time: null,
        heat_position: null,
        starting_position: null,
      });
    }
    return map.get(key)!;
  }

  for (const session of sessions) {
    for (const e of session.entries) {
      const entry = getOrCreate(e.driver_name, e.car_number);

      if (session.type === "qualifying" && e.time !== null) {
        // Best (lowest) qualifying time
        if (entry.qualifying_time === null || e.time < entry.qualifying_time) {
          entry.qualifying_time = e.time;
        }
      }

      if (session.type === "heat") {
        // Best (lowest finishing position) across heats
        if (!e.dnf) {
          if (entry.heat_position === null || e.position < entry.heat_position) {
            entry.heat_position = e.position;
          }
        }
      }

      if (session.type === "feature") {
        // If the table has a starting grid (no finish yet), use as starting_position
        // If it has finish positions too, that's post-race
        const isGrid = e.position > 0 && !e.dnf;
        if (isGrid && entry.starting_position === null) {
          entry.starting_position = e.position;
        }
      }

      // Car number — take first non-null
      if (!entry.car_number && e.car_number) entry.car_number = e.car_number;
    }
  }

  return Array.from(map.values());
}

// ── Fetch from MRP ────────────────────────────────────────────────────────────

export async function fetchMrpLineup(eventId: number): Promise<MrpLineupResult> {
  const url = `https://www.myracepass.com/events/${eventId}/races`;

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  let html: string;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    throw new Error(`Failed to fetch MRP event ${eventId}: ${e instanceof Error ? e.message : e}`);
  }

  const warnings: string[] = [];

  if (html.length < 500) {
    warnings.push("MRP returned a very short page — may require login or event not found.");
  }

  const { event_name, sessions } = parseMrpEventPage(html);

  if (sessions.length === 0) {
    warnings.push("No race sessions found on the MRP page. The event may not have started yet, or the page structure changed.");
  }

  const entries = mergeSessions(sessions);

  return { event_name, sessions, entries, warnings };
}
