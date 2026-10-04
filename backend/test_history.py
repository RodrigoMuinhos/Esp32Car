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
        self.assertEqual(c.finished_race, dict(duration_ms=22000, laps_ms=[10000, 8000], reason='Corrida finalizada pelo botão B.'))

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

    def test_data_survives_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'rc.db')
            h = History(path); h.driver = 'Rodrigo'; h.record(dict(duration_ms=1000, laps_ms=[800], reason='B')); h.db.close()
            h = History(path)
            self.assertEqual(h.driver, 'Rodrigo'); self.assertEqual(h.ranking()['totalRaces'], 1); h.db.close()


if __name__ == '__main__': unittest.main()
