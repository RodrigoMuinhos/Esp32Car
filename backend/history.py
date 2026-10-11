"""Race history and rankings in an embedded SQLite file (no server, stdlib only)."""
import json
import secrets
import sqlite3
import threading
from datetime import datetime

DEFAULT_DRIVER = 'Piloto'
RUNNING = 'Corrida em andamento.'
INTERRUPTED = 'Corrida interrompida (app fechado).'
TOP_DEFAULT = 8  # TOP N of the event (setting 'top_n')
# Session codes: no 0/O, 1/I, so they read well when spoken or typed.
CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
MAX_DRIVER = 24

SCHEMA = """
CREATE TABLE IF NOT EXISTS races (
    id INTEGER PRIMARY KEY,
    driver TEXT NOT NULL,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    laps INTEGER NOT NULL,
    best_lap_ms INTEGER,
    reason TEXT NOT NULL,
    target_laps INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    slot INTEGER NOT NULL DEFAULT 0,
    color INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS laps (
    race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    lap_ms INTEGER NOT NULL,
    at TEXT,
    PRIMARY KEY (race_id, number)
);
CREATE INDEX IF NOT EXISTS laps_by_time ON laps(lap_ms);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT
);
CREATE TABLE IF NOT EXISTS acceptances (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    slot INTEGER NOT NULL,
    color INTEGER NOT NULL,
    board_id TEXT,
    event_id INTEGER NOT NULL DEFAULT 0,
    result TEXT NOT NULL,
    trigger TEXT,
    items TEXT NOT NULL
);
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
            # Databases created before the time-trial mode get the new columns.
            columns = {row['name'] for row in self.db.execute('PRAGMA table_info(races)')}
            for column in ('target_laps', 'completed', 'slot', 'color', 'event_id'):
                if column not in columns:
                    self.db.execute(f'ALTER TABLE races ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0')
            if 'code' not in columns:
                self.db.execute('ALTER TABLE races ADD COLUMN code TEXT')
            if 'at' not in {row['name'] for row in self.db.execute('PRAGMA table_info(laps)')}:
                self.db.execute('ALTER TABLE laps ADD COLUMN at TEXT')
            # A race still "running" from a previous session: its laps are kept, it is closed.
            self.db.execute('UPDATE races SET reason = ? WHERE reason = ?', (INTERRUPTED, RUNNING))

    def setting(self, key, default=None):
        row = self.db.execute('SELECT value FROM settings WHERE key = ?', (key,)).fetchone()
        return row['value'] if row else default

    def set_setting(self, key, value):
        with self.lock, self.db:
            self.db.execute('INSERT OR REPLACE INTO settings VALUES (?, ?)', (key, str(value)))

    @property
    def driver(self):
        row = self.db.execute("SELECT value FROM settings WHERE key = 'driver'").fetchone()
        return row['value'] if row else DEFAULT_DRIVER

    @driver.setter
    def driver(self, name):
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO settings VALUES ('driver', ?)", (clean_driver(name),))

    def record(self, race, driver=None, started_at=None, slot=0, color=0):
        """Saves one finished race: dict(duration_ms, laps_ms, reason). `slot`: car color 1..4 (0 = unknown)."""
        laps = [int(ms) for ms in race.get('laps_ms', []) if ms > 0]
        started = started_at or datetime.now().astimezone()
        with self.lock, self.db:
            cursor = self.db.execute(
                'INSERT INTO races (driver, started_at, duration_ms, laps, best_lap_ms, reason, target_laps, completed, slot, color, '
                'event_id, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (clean_driver(driver or self.driver), started.isoformat(timespec='seconds'), int(race['duration_ms']),
                 len(laps), min(laps) if laps else None, race['reason'], int(race.get('target_laps') or 0),
                 int(bool(race.get('completed'))), int(slot), int(color), self.current_event_id(), self.new_code()))
            self.db.executemany('INSERT INTO laps (race_id, number, lap_ms) VALUES (?, ?, ?)',
                                [(cursor.lastrowid, i + 1, ms) for i, ms in enumerate(laps)])
            return cursor.lastrowid

    # ---------- a race saved while it runs: one row, then each lap as it closes ----------
    def start_race(self, slot=0, color=0, target_laps=0, started_at=None):
        started = started_at or datetime.now().astimezone()
        with self.lock, self.db:
            return self.db.execute(
                'INSERT INTO races (driver, started_at, duration_ms, laps, best_lap_ms, reason, target_laps, slot, color, event_id, code) '
                'VALUES (?, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?)',
                (DEFAULT_DRIVER, started.isoformat(timespec='seconds'), RUNNING, int(target_laps), int(slot), int(color),
                 self.current_event_id(), self.new_code())).lastrowid

    def add_lap(self, race_id, number, lap_ms, at=None):
        """Saves one lap the moment it closes; the race row follows (laps, best lap)."""
        when = (at or datetime.now().astimezone()).isoformat(timespec='seconds')
        with self.lock, self.db:
            self.db.execute('INSERT OR IGNORE INTO laps (race_id, number, lap_ms, at) VALUES (?, ?, ?, ?)',
                            (race_id, int(number), int(lap_ms), when))
            self.db.execute('UPDATE races SET laps = (SELECT COUNT(*) FROM laps WHERE race_id = ?), '
                            'best_lap_ms = (SELECT MIN(lap_ms) FROM laps WHERE race_id = ?) WHERE id = ?',
                            (race_id, race_id, race_id))

    def finish_race(self, race_id, race):
        """Closes a race saved lap by lap: dict(duration_ms, laps_ms, reason, target_laps, completed)."""
        laps = [int(ms) for ms in race.get('laps_ms', []) if ms > 0]
        with self.lock, self.db:
            self.db.executemany('INSERT OR IGNORE INTO laps (race_id, number, lap_ms) VALUES (?, ?, ?)',
                                [(race_id, i + 1, ms) for i, ms in enumerate(laps)])
            self.db.execute('UPDATE races SET duration_ms = ?, laps = ?, best_lap_ms = ?, reason = ?, target_laps = ?, '
                            'completed = ? WHERE id = ?',
                            (int(race['duration_ms']), len(laps), min(laps) if laps else None, race['reason'],
                             int(race.get('target_laps') or 0), int(bool(race.get('completed'))), race_id))
        return race_id

    def close_race(self, race_id, reason):
        """A race too short to count as a result: its laps stay, the row is closed."""
        with self.lock, self.db:
            self.db.execute('UPDATE races SET reason = ? WHERE id = ? AND reason = ?', (reason, race_id, RUNNING))

    def best_lap(self, event_id=None):
        """The event record: fastest lap of the open event (None outside an event: practice laps do not count)."""
        event_id = self.current_event_id() if event_id is None else event_id
        if not event_id: return None
        row = self.db.execute('SELECT l.lap_ms, l.at, r.started_at, r.slot, r.color, r.id, r.code FROM laps l '
                              'JOIN races r ON r.id = l.race_id WHERE r.event_id = ? ORDER BY l.lap_ms, r.started_at LIMIT 1',
                              (event_id,)).fetchone()
        return dict(lapMs=row['lap_ms'], at=row['at'] or row['started_at'], slot=row['slot'], color=row['color'],
                    raceId=row['id'], code=row['code']) if row else None

    # ---------- events: only laps inside an open event count for records and ranking ----------
    def new_code(self):
        while True:
            code = ''.join(secrets.choice(CODE_CHARS) for _ in range(6))
            if not self.db.execute('SELECT 1 FROM races WHERE code = ?', (code,)).fetchone(): return code

    def current_event(self):
        row = self.db.execute('SELECT id, name, opened_at FROM events WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1').fetchone()
        return dict(id=row['id'], name=row['name'], openedAt=row['opened_at']) if row else None

    def current_event_id(self):
        event = self.current_event()
        return event['id'] if event else 0

    def open_event(self, name):
        """Opens an event (one at a time). Races before it were practice and do not count."""
        name = ' '.join(str(name or '').split())[:60]
        if not name or self.current_event(): return None
        with self.lock, self.db:
            return self.db.execute('INSERT INTO events (name, opened_at) VALUES (?, ?)',
                                   (name, datetime.now().astimezone().isoformat(timespec='seconds'))).lastrowid

    def close_event(self):
        event = self.current_event()
        if not event: return None
        with self.lock, self.db:
            self.db.execute('UPDATE events SET closed_at = ? WHERE id = ?',
                            (datetime.now().astimezone().isoformat(timespec='seconds'), event['id']))
        return event['id']

    # ---------- technical acceptance (Central Técnica): every full run is kept ----------
    def record_acceptance(self, slot, color, board_id, result, trigger, items):
        with self.lock, self.db:
            return self.db.execute(
                'INSERT INTO acceptances (at, slot, color, board_id, event_id, result, trigger, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                (datetime.now().astimezone().isoformat(timespec='seconds'), int(slot), int(color), board_id,
                 self.current_event_id(), result, trigger, json.dumps(items, ensure_ascii=False))).lastrowid

    def acceptances(self, slot=None, limit=20):
        rows = self.db.execute('SELECT * FROM acceptances WHERE ? IS NULL OR slot = ? ORDER BY id DESC LIMIT ?',
                               (slot, slot, limit)).fetchall()
        return [dict(id=r['id'], at=r['at'], slot=r['slot'], color=r['color'], boardId=r['board_id'], eventId=r['event_id'],
                     result=r['result'], trigger=r['trigger'], items=json.loads(r['items'])) for r in rows]

    def top_n(self):
        value = str(self.setting('top_n', TOP_DEFAULT))
        return int(value) if value.isdigit() and 1 <= int(value) <= 64 else TOP_DEFAULT

    def event_ranking(self, event_id=None):
        """Every session of the event by its best lap (all kept, not only the TOP N), and the cut time."""
        event_id = self.current_event_id() if event_id is None else event_id
        top = self.top_n()
        rows = [dict(position=i + 1, raceId=r['id'], code=r['code'], slot=r['slot'], color=r['color'],
                     bestLapMs=r['best_lap_ms'], date=r['started_at'], inTop=i < top)
                for i, r in enumerate(self.db.execute(
                    'SELECT id, code, slot, color, best_lap_ms, started_at FROM races '
                    'WHERE event_id = ? AND best_lap_ms IS NOT NULL ORDER BY best_lap_ms, id', (event_id,)))] if event_id else []
        return dict(topN=top, total=len(rows), cutMs=rows[top - 1]['bestLapMs'] if len(rows) >= top else None, rows=rows)

    def lap_position(self, lap_ms):
        """1-based position of a lap time in the all-time lap ranking."""
        return self.db.execute('SELECT COUNT(*) + 1 FROM laps WHERE lap_ms < ?', (lap_ms,)).fetchone()[0]

    def trial_position(self, target_laps, duration_ms):
        """1-based position of a completed time trial among those of the same length."""
        return self.db.execute('SELECT COUNT(*) + 1 FROM races WHERE completed = 1 AND target_laps = ? AND duration_ms < ?',
                               (target_laps, duration_ms)).fetchone()[0]

    def ranking(self, limit=10, recent=20):
        best = self.db.execute(
            'SELECT r.driver, l.lap_ms, r.started_at, r.id AS race_id, r.slot, r.color FROM laps l JOIN races r ON r.id = l.race_id '
            'ORDER BY l.lap_ms, r.started_at LIMIT ?', (limit,)).fetchall()
        longest = self.db.execute(
            'SELECT driver, duration_ms, laps, started_at, id AS race_id, slot, color FROM races '
            'ORDER BY laps DESC, duration_ms LIMIT ?', (limit,)).fetchall()
        races = self.db.execute(
            'SELECT id, driver, started_at, duration_ms, laps, best_lap_ms, reason, target_laps, completed, slot, color FROM races '
            'ORDER BY id DESC LIMIT ?', (recent,)).fetchall()
        trials = {
            str(target): [dict(driver=r['driver'], durationMs=r['duration_ms'], bestLapMs=r['best_lap_ms'],
                               date=r['started_at'], raceId=r['id'], slot=r['slot'], color=r['color']) for r in self.db.execute(
                'SELECT id, driver, duration_ms, best_lap_ms, started_at, slot, color FROM races WHERE completed = 1 AND target_laps = ? '
                'ORDER BY duration_ms, started_at LIMIT ?', (target, limit))]
            for target in (3, 5)}
        totals = self.db.execute('SELECT COUNT(*), COALESCE(SUM(duration_ms), 0) FROM races').fetchone()
        event = self.current_event()
        return dict(
            driver=self.driver,
            totalRaces=totals[0], totalMs=totals[1], timeTrials=trials,
            event=dict(event, **self.event_ranking(event['id'])) if event else None,
            bestLaps=[dict(driver=r['driver'], lapMs=r['lap_ms'], date=r['started_at'], raceId=r['race_id'], slot=r['slot'],
                           color=r['color']) for r in best],
            mostLaps=[dict(driver=r['driver'], laps=r['laps'], durationMs=r['duration_ms'], date=r['started_at'],
                           raceId=r['race_id'], slot=r['slot'], color=r['color']) for r in longest if r['laps']],
            recent=[dict(id=r['id'], driver=r['driver'], date=r['started_at'], durationMs=r['duration_ms'],
                         laps=r['laps'], bestLapMs=r['best_lap_ms'], reason=r['reason'],
                         targetLaps=r['target_laps'], completed=bool(r['completed']), slot=r['slot'], color=r['color']) for r in races])

    def clear(self):
        with self.lock, self.db:
            self.db.execute('DELETE FROM laps'); self.db.execute('DELETE FROM races')
