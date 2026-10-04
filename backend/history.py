"""Race history and rankings in an embedded SQLite file (no server, stdlib only)."""
import sqlite3
import threading
from datetime import datetime

DEFAULT_DRIVER = 'Piloto'
MAX_DRIVER = 24

SCHEMA = """
CREATE TABLE IF NOT EXISTS races (
    id INTEGER PRIMARY KEY,
    driver TEXT NOT NULL,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    laps INTEGER NOT NULL,
    best_lap_ms INTEGER,
    reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS laps (
    race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    lap_ms INTEGER NOT NULL,
    PRIMARY KEY (race_id, number)
);
CREATE INDEX IF NOT EXISTS laps_by_time ON laps(lap_ms);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def clean_driver(name):
    name = ' '.join(str(name or '').split())[:MAX_DRIVER]
    return name or DEFAULT_DRIVER


class History:
    def __init__(self, path=':memory:'):
        self.lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        with self.lock, self.db:
            self.db.execute('PRAGMA foreign_keys = ON')
            self.db.executescript(SCHEMA)

    @property
    def driver(self):
        row = self.db.execute("SELECT value FROM settings WHERE key = 'driver'").fetchone()
        return row['value'] if row else DEFAULT_DRIVER

    @driver.setter
    def driver(self, name):
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO settings VALUES ('driver', ?)", (clean_driver(name),))

    def record(self, race, driver=None, started_at=None):
        """Saves one finished race: dict(duration_ms, laps_ms, reason). Returns its id."""
        laps = [int(ms) for ms in race.get('laps_ms', []) if ms > 0]
        started = started_at or datetime.now().astimezone()
        with self.lock, self.db:
            cursor = self.db.execute(
                'INSERT INTO races (driver, started_at, duration_ms, laps, best_lap_ms, reason) VALUES (?, ?, ?, ?, ?, ?)',
                (clean_driver(driver or self.driver), started.isoformat(timespec='seconds'), int(race['duration_ms']),
                 len(laps), min(laps) if laps else None, race['reason']))
            self.db.executemany('INSERT INTO laps VALUES (?, ?, ?)',
                                [(cursor.lastrowid, i + 1, ms) for i, ms in enumerate(laps)])
            return cursor.lastrowid

    def lap_position(self, lap_ms):
        """1-based position of a lap time in the all-time lap ranking."""
        return self.db.execute('SELECT COUNT(*) + 1 FROM laps WHERE lap_ms < ?', (lap_ms,)).fetchone()[0]

    def ranking(self, limit=10, recent=20):
        best = self.db.execute(
            'SELECT r.driver, l.lap_ms, r.started_at, r.id AS race_id FROM laps l JOIN races r ON r.id = l.race_id '
            'ORDER BY l.lap_ms, r.started_at LIMIT ?', (limit,)).fetchall()
        longest = self.db.execute(
            'SELECT driver, duration_ms, laps, started_at, id AS race_id FROM races '
            'ORDER BY laps DESC, duration_ms LIMIT ?', (limit,)).fetchall()
        races = self.db.execute(
            'SELECT id, driver, started_at, duration_ms, laps, best_lap_ms, reason FROM races '
            'ORDER BY id DESC LIMIT ?', (recent,)).fetchall()
        totals = self.db.execute('SELECT COUNT(*), COALESCE(SUM(duration_ms), 0) FROM races').fetchone()
        return dict(
            driver=self.driver,
            totalRaces=totals[0], totalMs=totals[1],
            bestLaps=[dict(driver=r['driver'], lapMs=r['lap_ms'], date=r['started_at'], raceId=r['race_id']) for r in best],
            mostLaps=[dict(driver=r['driver'], laps=r['laps'], durationMs=r['duration_ms'], date=r['started_at'],
                           raceId=r['race_id']) for r in longest if r['laps']],
            recent=[dict(id=r['id'], driver=r['driver'], date=r['started_at'], durationMs=r['duration_ms'],
                         laps=r['laps'], bestLapMs=r['best_lap_ms'], reason=r['reason']) for r in races])

    def clear(self):
        with self.lock, self.db:
            self.db.execute('DELETE FROM laps'); self.db.execute('DELETE FROM races')
