import { DatabaseSync } from "node:sqlite";
import { copyFileSync } from "node:fs";

const databases = ["public/data/dirtiq.seed.db"];

const events = [
  {
    raceId: 857,
    source: "https://worldofoutlaws.com/latemodels/results/?event=603594&series=latemodels",
    purseToWin: 100000,
    entries: [
      [1, 10, "32", "Bobby Pierce", 33, 100000],
      [2, 2, "1S", "Brandon Sheppard", 0, 25000],
      [3, 6, "74X", "Ethan Dotson", 0, 12000],
      [4, 20, "71", "Hudson O'Neal", 0, 9000],
      [5, 14, "19", "Dustin Sorensen", 0, 7500],
      [6, 4, "96", "Tanner English", 0, 6000],
      [7, 9, "9M", "Tim McCreadie", 0, 5000],
      [8, 11, "97", "Cody Overton", 0, 4500],
      [9, 18, "25", "Jason Feger", 0, 4400],
      [10, 17, "1", "Tyler Erb", 0, 4200],
      [11, 16, "19R", "Ryan Gustin", 0, 4000],
      [12, 8, "22*", "Zack Mitchell", 0, 3800],
      [13, 13, "6", "Clay Harris", 0, 3600],
      [14, 19, "14", "Trey Mills", 0, 3400],
      [15, 24, "49", "Jake Timm", 0, 3350],
      [16, 5, "44", "Chris Madden", 0, 3300],
      [17, 28, "B1", "Brent Larson", 0, 250],
      [18, 3, "9", "Nick Hoffman", 53, 3200],
      [19, 7, "09", "Michael Leach", 0, 3100],
      [20, 1, "60", "Dan Ebert", 14, 3000],
      [21, 26, "20TC", "Tristan Chamberlain", 0, 3000],
      [22, 22, "13", "Dallon Murty", 0, 3000],
      [23, 29, "1Z", "Logan Zarin", 0, 110],
      [24, 25, "28", "Dennis Erb Jr", 0, 3000],
      [25, 21, "58V", "Daulton Wilson", 0, 3000],
      [26, 15, "8S", "Kyle Strickler", 0, 3000],
      [27, 12, "0", "Jake O'Neil", 0, 3000],
      [28, 23, "18", "Shannon Babb", 0, 3000],
      [29, 27, "11G", "Trevor Gundaker", 0, 3000],
    ],
  },
  {
    raceId: 890,
    source: "https://www.dirtondirt.com/racewire9927.html",
    purseToWin: 75000,
    entries: [
      [1, 9, "11", "Josh Rice", 2, 75000],
      [2, 3, "49", "Jonathan Davenport", 30, 25000],
      [3, 19, "49", "Luke Morey", 0, 10000],
      [4, 5, "99", "Devin Moran", 21, 9000],
      [5, 2, "76", "Brandon Overton", 0, 8000],
      [6, 18, "13", "Dallon Murty", 0, 7000],
      [7, 27, "6", "Clay Harris", 0, 3500],
      [8, 10, "93", "Carson Ferguson", 0, 5000],
      [9, 26, "3S", "Brian Shirley", 0, 4750],
      [10, 7, "40B", "Kyle Bronson", 38, 4500],
      [11, 16, "71", "Hudson O'Neal", 0, 4250],
      [12, 12, "22", "Daniel Hilsabeck", 0, 4000],
      [13, 14, "93", "Cory Lawler", 0, 3750],
      [14, 25, "111", "Max Blair", 0, 3700],
      [15, 6, "58", "Garrett Alberson", 0, 3650],
      [16, 8, "1", "Tyler Erb", 0, 3600],
      [17, 23, "17", "Zack Dohm", 0, 3550],
      [18, 22, "16", "Justin Rattliff", 0, 3500],
      [19, 11, "20RT", "Ricky Thornton Jr", 0, 3500],
      [20, 15, "8", "Dillon McCowan", 0, 3500],
      [21, 24, "5", "Drake Troutman", 0, 3500],
      [22, 1, "60", "Dan Ebert", 7, 3500],
      [23, 4, "1", "Brandon Sheppard", 0, 3500],
      [24, 13, "157", "Mike Marlar", 0, 3500],
      [25, 21, "32", "Bobby Pierce", 0, 3500],
      [26, 17, "99JR", "Frank Heckenast Jr", 0, 3500],
      [27, 20, "18", "Shannon Babb", 0, 3500],
    ],
  },
];

function normalize(name) {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

for (const path of databases) {
  copyFileSync(path, `${path}.before-recent-results.bak`);
  const db = new DatabaseSync(path);
  const drivers = db.prepare("SELECT id, name FROM drivers").all();
  const findDriver = (name) => {
    const wanted = normalize(name);
    return drivers.find((driver) => normalize(driver.name) === wanted);
  };
  const insertDriver = db.prepare("INSERT INTO drivers (name, car_number, division) VALUES (?, ?, ?)");
  const upsert = db.prepare(`
    INSERT INTO race_entries
      (race_id, driver_id, car_number, starting_position, finishing_position, laps_led, dnf, money, entry_series, entry_status)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'confirmed')
    ON CONFLICT(race_id, driver_id) DO UPDATE SET
      car_number = excluded.car_number,
      starting_position = excluded.starting_position,
      finishing_position = excluded.finishing_position,
      laps_led = excluded.laps_led,
      dnf = excluded.dnf,
      money = excluded.money,
      entry_series = excluded.entry_series,
      entry_status = excluded.entry_status
  `);

  db.exec("BEGIN");
  try {
    for (const event of events) {
      const race = db.prepare("SELECT division FROM races WHERE id = ?").get(event.raceId);
      if (!race) throw new Error(`Race ${event.raceId} not found in ${path}`);
      for (const [finish, start, car, name, lapsLed, money] of event.entries) {
        let driver = findDriver(name);
        if (!driver) {
          const result = insertDriver.run(name, car, race.division);
          driver = { id: Number(result.lastInsertRowid), name };
          drivers.push(driver);
        }
        upsert.run(event.raceId, driver.id, car, start, finish, lapsLed, money, race.division);
      }
      db.prepare(`
        UPDATE races
        SET status = 'complete', betting_status = 'closed', is_live = 0,
            purse_to_win = ?, results_source = ?, results_imported_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(event.purseToWin, event.source, event.raceId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
  console.log(`Imported ${events.length} events into ${path}`);
}
