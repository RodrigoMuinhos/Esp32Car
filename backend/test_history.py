import os
import tempfile
import unittest
from backend.control import Controller
from backend.history import History
from backend.test_control import pad


class RaceResultTests(unittest.TestCase):
    def race(self):
        c = Controller(); c.connected = True
        c.tick(0, pad()); c.tick(.05, pad(start=True)); c.tick(3.05, pad(throttle=100))
        self.assertEqual(c.phase, 'running')
        return c

    def test_laps_and_duration_are_measured_from_go(self):
        c = self.race()
        c.message(dict(type='lap', data={}), 13.05)
        c.message(dict(type='lap', data={}), 13.5)   # double click: ignored
        c.message(dict(type='lap', data={}), 21.05)
        c.tick(25.05, pad(finish=True))
        self.assertEqual(c.finished_race, dict(duration_ms=22000, laps_ms=[10000, 8000], reason='Corrida finalizada pelo botão B.',
                                               target_laps=0, completed=False))

    def test_time_trial_ends_on_last_lap_and_wheel_y_marks_laps(self):
        c = Controller(); c.connected = True
        c.message(dict(type='mode', data=dict(laps=3)), 0); self.assertEqual(c.target_laps, 3)
        c.message(dict(type='mode', data=dict(laps=4)), 0); self.assertEqual(c.target_laps, 3)  # only 0, 3, 5
        c.tick(0, pad()); c.tick(.05, pad(start=True)); c.tick(3.05, pad(throttle=100))
        c.message(dict(type='mode', data=dict(laps=5)), 3.1); self.assertEqual(c.target_laps, 3)  # locked while racing
        c.tick(10.05, pad(throttle=100, lap=True)); c.tick(10.1, pad(throttle=100, lap=True))  # held Y: one lap
        self.assertEqual(len(c.laps), 1)
        c.message(dict(type='lap', data={}), 17.05)
        c.tick(17.1, pad(throttle=100)); c.tick(25.05, pad(throttle=100, lap=True))
        self.assertEqual(c.phase, 'finished'); self.assertEqual(c.mask, 0)
        self.assertEqual(c.reason, 'Corrida concluída: 3 voltas.')
        self.assertEqual(c.finished_race, dict(duration_ms=22000, laps_ms=[7000, 7000, 8000], reason='Corrida concluída: 3 voltas.',
                                               target_laps=3, completed=True))

    def test_inactivity_time_ends_at_last_movement(self):
        c = self.race(); c.tick(5.05, pad(throttle=100))
        t = 5.1
        while c.phase == 'running': c.tick(round(t, 2), pad()); t += .05
        self.assertEqual(c.finished_race['duration_ms'], 2000)
        self.assertIn('inatividade', c.finished_race['reason'])

    def test_panel_stop_and_lost_board_are_saved_but_tiny_races_are_not(self):
        c = self.race(); c.message(dict(type='stop', data={}), 9.05)
        self.assertEqual(c.finished_race['duration_ms'], 6000)
        c = self.race(); c.connected = False; c.tick(10, pad())
        self.assertEqual(c.finished_race['reason'], 'ESP32 desconectado.')
        c = self.race(); c.tick(3.5, pad(finish=True))
        self.assertIsNone(c.finished_race)


class HistoryTests(unittest.TestCase):
    def test_races_keep_the_slot_and_the_car_color(self):
        h = History()
        h.record(dict(duration_ms=20000, laps_ms=[9000], reason='Corrida finalizada pelo botão B.'), 'P', None, 2, 5)
        r = h.ranking()
        self.assertEqual((r['recent'][0]['slot'], r['recent'][0]['color']), (2, 5))
        self.assertEqual((r['bestLaps'][0]['slot'], r['bestLaps'][0]['color']), (2, 5))
        self.assertEqual(r['mostLaps'][0]['color'], 5)

    def test_ranking_orders_laps_and_keeps_driver(self):
        h = History()
        self.assertEqual(h.driver, 'Piloto')
        h.driver = '  Ana   Clara  '
        h.record(dict(duration_ms=30000, laps_ms=[12000, 9500], reason='B'))
        h.driver = ''
        h.record(dict(duration_ms=20000, laps_ms=[9000], reason='B'), driver='Rodrigo')
        h.record(dict(duration_ms=5000, laps_ms=[], reason='inatividade'))
        r = h.ranking()
        self.assertEqual([(x['driver'], x['lapMs']) for x in r['bestLaps']], [('Rodrigo', 9000), ('Ana Clara', 9500), ('Ana Clara', 12000)])
        self.assertEqual(r['recent'][0]['driver'], 'Piloto'); self.assertIsNone(r['recent'][0]['bestLapMs'])
        self.assertEqual(r['mostLaps'][0]['laps'], 2)
        self.assertEqual((r['totalRaces'], r['totalMs']), (3, 55000))
        self.assertEqual(h.lap_position(9200), 2)

    def test_time_trial_ranking_only_counts_completed_races(self):
        h = History()
        h.record(dict(duration_ms=40000, laps_ms=[13000, 13000, 14000], reason='ok', target_laps=3, completed=True), driver='A')
        h.record(dict(duration_ms=35000, laps_ms=[12000, 11000, 12000], reason='ok', target_laps=3, completed=True), driver='B')
        h.record(dict(duration_ms=20000, laps_ms=[10000], reason='B', target_laps=3, completed=False), driver='C')
        h.record(dict(duration_ms=70000, laps_ms=[14000] * 5, reason='ok', target_laps=5, completed=True), driver='D')
        trials = h.ranking()['timeTrials']
        self.assertEqual([t['driver'] for t in trials['3']], ['B', 'A'])
        self.assertEqual([t['driver'] for t in trials['5']], ['D'])
        self.assertEqual(h.trial_position(3, 38000), 2)
        self.assertTrue(h.ranking()['recent'][0]['completed'])

    def test_old_database_gets_time_trial_columns(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'old.db')
            db = sqlite3.connect(path)
            db.execute('CREATE TABLE races (id INTEGER PRIMARY KEY, driver TEXT NOT NULL, started_at TEXT NOT NULL, '
                       'duration_ms INTEGER NOT NULL, laps INTEGER NOT NULL, best_lap_ms INTEGER, reason TEXT NOT NULL)')
            db.execute("INSERT INTO races VALUES (1, 'Velho', '2026-10-01T10:00:00', 9000, 0, NULL, 'B')"); db.commit(); db.close()
            h = History(path)
            self.assertEqual(h.ranking()['recent'][0]['targetLaps'], 0); h.db.close()

    def test_data_survives_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'rc.db')
            h = History(path); h.driver = 'Rodrigo'; h.record(dict(duration_ms=1000, laps_ms=[800], reason='B')); h.db.close()
            h = History(path)
            self.assertEqual(h.driver, 'Rodrigo'); self.assertEqual(h.ranking()['totalRaces'], 1); h.db.close()


class LapByLapTests(unittest.TestCase):
    def test_each_lap_is_saved_when_it_closes_and_the_race_is_closed_at_the_end(self):
        h = History()
        h.open_event('Fortaleza')
        race = h.start_race(slot=2, color=5, target_laps=0)
        h.add_lap(race, 1, 35201)
        h.add_lap(race, 2, 33940)
        self.assertEqual(h.best_lap()['lapMs'], 33940)  # already in the ranking, mid-race
        self.assertEqual(h.ranking()['recent'][0]['laps'], 2)
        h.add_lap(race, 3, 32814)
        h.finish_race(race, dict(duration_ms=110000, laps_ms=[35201, 33940, 32814], reason='Corrida finalizada pelo botão B.'))
        recent = h.ranking()['recent'][0]
        self.assertEqual((recent['laps'], recent['bestLapMs'], recent['durationMs']), (3, 32814, 110000))
        best = h.best_lap()
        self.assertEqual((best['lapMs'], best['slot'], best['color']), (32814, 2, 5))
        self.assertIsNotNone(best['at'])

    def test_a_race_left_running_is_closed_when_the_app_opens_again(self):
        import tempfile, pathlib
        path = pathlib.Path(tempfile.mkdtemp()) / 'race.db'
        h = History(str(path))
        race = h.start_race(slot=1, color=1)
        h.add_lap(race, 1, 40000)
        h.db.close()
        again = History(str(path))
        recent = again.ranking()['recent'][0]
        self.assertIn('interrompida', recent['reason'])
        self.assertEqual(recent['laps'], 1)  # the lap was not lost
        again.db.close()


if __name__ == '__main__': unittest.main()


class EventTests(unittest.TestCase):
    def test_practice_laps_do_not_count_and_events_open_one_at_a_time(self):
        h = History()
        practice = h.start_race(slot=1, color=1)
        h.add_lap(practice, 1, 20000)  # very fast practice lap
        self.assertIsNone(h.best_lap())  # no event open: no record
        self.assertIsNone(h.open_event('   '))
        event = h.open_event('Fortaleza - Shopping Iguatemi')
        self.assertIsNone(h.open_event('Outro'))  # one at a time
        self.assertEqual(h.current_event()['name'], 'Fortaleza - Shopping Iguatemi')
        race = h.start_race(slot=2, color=5)
        h.add_lap(race, 1, 33000)
        self.assertEqual(h.best_lap()['lapMs'], 33000)  # the 20 s practice lap is not the record
        self.assertEqual(h.close_event(), event)
        self.assertIsNone(h.current_event())
        self.assertIsNone(h.best_lap())

    def test_event_ranking_keeps_every_session_with_the_cut_after_the_top_n(self):
        h = History()
        h.set_setting('top_n', '3')
        h.open_event('Teste')
        codes = []
        for i, best in enumerate((33500, 31842, 32800, 34001, 32104)):
            race = h.start_race(slot=1, color=1)
            h.add_lap(race, 1, best)
            codes.append(h.db.execute('SELECT code FROM races WHERE id = ?', (race,)).fetchone()[0])
        ranking = h.event_ranking()
        self.assertEqual((ranking['topN'], ranking['total']), (3, 5))  # all kept, not only the TOP 3
        self.assertEqual([r['bestLapMs'] for r in ranking['rows']], [31842, 32104, 32800, 33500, 34001])
        self.assertEqual(ranking['cutMs'], 32800)
        self.assertEqual([r['inTop'] for r in ranking['rows']], [True, True, True, False, False])
        self.assertEqual(len(set(codes)), 5)
        self.assertTrue(all(len(c) == 6 and not set(c) & set('01IO') for c in codes))
        self.assertEqual(h.ranking()['event']['cutMs'], 32800)

