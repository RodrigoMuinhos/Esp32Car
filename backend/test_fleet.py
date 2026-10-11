import unittest

from backend.fleet import Fleet
from backend.history import History
from backend.test_control import FakeSerial, pad


class Car(FakeSerial):
    """A fake ESP32 with firmware v6: answers '?' with its unique ID."""
    ids = {}

    def __init__(self, port, *args, **kwargs):
        super().__init__()
        self.board_id = Car.ids.get(port)
        self.buffer = self.hello()

    def hello(self):
        return (f'Pronto CONTROLE v6 ID {self.board_id}\n' if self.board_id else 'Pronto CONTROLE v5\n').encode() + b'ESTADO 0\n'

    def write(self, data):
        super().write(data)
        if self.respond and b'?' in data: self.buffer = self.buffer.replace(b'Pronto CONTROLE v5\n', self.hello())


def fleet_with(ports, ids, settings=None):
    Car.ids = ids
    fleet = Fleet(serial_factory=lambda port, *a, **k: Car(port), settings=settings or History())
    fleet.scan(0, ports)
    return fleet


def run(fleet, t0, t1, step=.05):
    t = t0
    while t <= t1 + 1e-9:
        fleet.step(round(t, 3)); t += step


class FleetTests(unittest.TestCase):
    def test_finishing_order_names_the_champion_and_resets_on_the_next_start(self):
        f = fleet_with(['COM3', 'COM4'], {'COM3': 'AAA', 'COM4': 'BBB'})
        f.set_auto_test(False); f.available = 2
        run(f, 0, .5)
        f.pads = [pad(), pad(), None, None]
        self.assertEqual(f.start_all(.5), [1, 2])
        f.finished(f.slots[1], 40000); f.finished(f.slots[0], 41000); f.finished(f.slots[1], 40000)
        order = f.summary(1)['finishOrder']
        self.assertEqual([(r['slot'], r['position']) for r in order], [(2, 1), (1, 2)])  # 02 is the champion
        run(f, .55, 4)
        f.stop_all(); run(f, 4.05, 4.2)
        f.pads = [pad(), pad(), None, None]
        f.start_all(4.3)
        self.assertEqual(f.summary(4.3)['finishOrder'], [])

    def test_virtual_drivers_draw_every_lap_time(self):
        from backend.simulated import AutoPilot
        pilot = AutoPilot()
        times = {round(pilot.lap_time(), 3) for _ in range(20)}
        self.assertGreater(len(times), 15)  # no fixed rhythm: positions change, the winner changes
        self.assertTrue(all(AutoPilot.LAP_MIN <= t <= AutoPilot.LAP_MAX for t in times))

    def test_boards_fill_the_color_slots_and_run_the_self_test(self):
        f = fleet_with(['COM3', 'COM4'], {'COM3': 'AAA', 'COM4': 'BBB'})
        run(f, 0, 2)
        azul, laranja = f.slots[0], f.slots[1]
        self.assertEqual((azul.board_id, laranja.board_id), ('AAA', 'BBB'))
        self.assertTrue(azul.controller.connected and laranja.controller.connected)
        self.assertEqual(f.board_of(azul).test['results'], [True] * 4)  # self-test on arrival
        self.assertIn('carrinho novo', f.events[0]['text'])

    def test_four_cars_race_at_once_with_their_own_wheels(self):
        f = fleet_with([f'COM{i}' for i in range(3, 7)], {f'COM{i}': f'ID{i}' for i in range(3, 7)})
        f.set_auto_test(False)
        f.available = 4  # all four slots configured
        run(f, 0, .5)
        self.assertEqual(f.start_all(.5), [1, 2, 3, 4])
        f.pads = [pad(throttle=100), pad(steering=-50), pad(), pad(throttle=100, steering=40)]
        run(f, .55, 3.7)
        masks = [s.controller.mask for s in f.slots]
        self.assertEqual(masks, [1, 8, 0, 5])  # wheel 1 accelerates car 1, wheel 2 turns car 2 left...
        self.assertTrue(all(s.controller.phase == 'running' for s in f.slots))
        f.slots[0].controller.add_lap(5); run(f, 5.05, 5.1)
        self.assertEqual(f.classification(5.1)[0]['slot'], 1)  # one lap ahead
        f.stop_all()
        self.assertEqual([s.controller.mask for s in f.slots], [0, 0, 0, 0])

    def test_broken_car_swapped_by_a_spare_takes_the_same_color(self):
        settings = History()
        f = fleet_with(['COM3', 'COM4'], {'COM3': 'AAA', 'COM4': 'BBB'}, settings)
        run(f, 0, 1)
        f.boards['COM4'].link.respond = False  # LARANJA breaks
        run(f, 1.05, 2.5)
        self.assertNotIn('COM4', f.boards)
        self.assertFalse(f.slots[1].controller.connected)
        Car.ids['COM9'] = 'SPARE'
        f.scan(2.5, ['COM3', 'COM9'])
        run(f, 2.55, 3.5)
        # Fresh slots 3 and 4 come first; with all four known, the spare replaces the only missing car.
        self.assertEqual(f.slots[2].board_id, 'SPARE')
        f2 = fleet_with([], {}, settings)
        self.assertEqual(f2.slots[0].board_id, 'AAA')  # assignments survive a restart

    def test_spare_replaces_the_only_missing_car_when_all_slots_are_known(self):
        f = fleet_with([f'COM{i}' for i in range(3, 7)], {f'COM{i}': f'ID{i}' for i in range(3, 7)})
        run(f, 0, .5)
        f.drop(f.boards['COM4'], 'quebrou', .5)  # LARANJA (ID4) breaks
        Car.ids['COM9'] = 'SPARE'
        f.scan(.6, ['COM9'])
        run(f, .65, 1)
        self.assertEqual(f.slots[1].board_id, 'SPARE')
        self.assertIn('carrinho trocado', f.events[0]['text'])

    def test_unknown_board_waits_for_the_operator_and_can_be_assigned(self):
        f = fleet_with([f'COM{i}' for i in range(3, 7)], {f'COM{i}': f'ID{i}' for i in range(3, 7)})
        run(f, 0, .5)
        f.drop(f.boards['COM5'], 'x', .5); f.drop(f.boards['COM6'], 'x', .5)  # two cars missing
        Car.ids['COM9'] = 'NEW'
        f.scan(.6, ['COM9'])
        run(f, .65, 2.5)
        self.assertIsNone(f.boards['COM9'].slot)
        self.assertEqual(f.summary(2.5)['spareBoards'][0]['boardId'], 'NEW')
        self.assertEqual(f.boards['COM9'].test['results'], [True] * 4)  # tested even without a slot
        self.assertTrue(f.assign('COM9', 4))
        run(f, 2.55, 4)
        self.assertEqual(f.slots[3].board_id, 'NEW')
        self.assertTrue(f.slots[3].controller.connected)

    def test_v5_board_without_id_is_known_by_its_port(self):
        f = fleet_with(['COM7'], {})
        run(f, 0, .5)
        self.assertEqual(f.slots[0].board_id, 'PORTA-COM7')
        self.assertEqual(f.summary(.5)['slots'][0]['firmware'], 5)

    def test_a_port_that_is_not_a_board_is_left_alone(self):
        f = Fleet(serial_factory=lambda port, *a, **k: Car(port))
        Car.ids = {}
        f.scan(0, ['COM5'])
        f.boards['COM5'].link.respond = False
        f.boards['COM5'].link.buffer = b''
        run(f, 0, 9)
        self.assertNotIn('COM5', f.boards)
        f.scan(10, ['COM5']); self.assertNotIn('COM5', f.boards)  # not retried right away

    def test_wheel_sync_holding_a_and_b_for_two_seconds(self):
        f = fleet_with(['COM3', 'COM4'], {'COM3': 'AAA', 'COM4': 'BBB'})
        f.set_auto_test(False)
        f.pads = [pad(), None, None, None]
        run(f, 0, .5)
        f.pair(1, .5)
        f.pads = [pad(start=True), None, pad(start=True), None]  # A alone: no sync, and no start meanwhile
        run(f, .55, 3)
        self.assertEqual(f.pad_map[0], 0)
        self.assertEqual(f.slots[0].controller.phase, 'idle')
        f.pads = [pad(), None, pad(start=True, finish=True), None]  # wheel #3 holds A+B
        run(f, 3.05, 4.5)
        self.assertEqual(f.pad_map[0], 0)  # 1.5 s: not yet
        run(f, 4.55, 5.2)
        self.assertEqual(f.pad_map[0], 2)
        self.assertIsNone(f.pairing)
        self.assertIn('volante sincronizado', f.events[0]['text'])
        run(f, 5.25, 6)
        self.assertEqual(f.slots[0].controller.phase, 'idle')  # the A+B that synced did not start the race
        f.pads = [pad(), None, pad(), None]; run(f, 6.05, 6.1)
        f.pads = [pad(), None, pad(start=True), None]; run(f, 6.15, 6.2)
        self.assertEqual(f.slots[0].controller.phase, 'countdown')

    def test_only_the_cars_the_event_owns_are_available(self):
        settings = History()
        self.assertEqual(fleet_with([], {}, settings).summary(0)['available'], 1)
        settings.set_setting('available_slots', '4')
        self.assertEqual(fleet_with([], {}, settings).summary(0)['available'], 4)
        settings.set_setting('available_slots', '9')
        self.assertEqual(fleet_with([], {}, settings).summary(0)['available'], 1)

    def test_unconfigured_slot_cannot_start(self):
        f = fleet_with(['COM3', 'COM4'], {'COM3': 'AAA', 'COM4': 'BBB'})
        f.set_auto_test(False)
        f.pads = [pad(), pad(), None, None]
        run(f, 0, .5)
        self.assertEqual(f.start_all(.5), [1])  # slot 2 has a board and a wheel, but is not configured
        car2 = f.summary(.5)['slots'][1]
        self.assertTrue(car2['blocked'])
        self.assertIn('não configurada', car2['status'])

    def test_setup_wizard_configures_the_next_slot_step_by_step(self):
        settings = History()
        f = fleet_with(['COM3', 'COM4'], {'COM3': 'AAA', 'COM4': 'BBB'}, settings)
        f.set_auto_test(False)
        f.pads = [pad(), None, None, None]
        run(f, 0, .5)
        self.assertFalse(f.setup_start(1, .5))  # AZUL ELÉTRICO is already in slot 1
        self.assertFalse(f.setup_start(99, .5))
        self.assertTrue(f.setup_start(5, .5))  # VERDE for slot 2
        self.assertFalse(f.setup_start(6, .5))  # one wizard at a time
        self.assertEqual(f.slots[1].name, 'VERDE')
        state = f.summary(.5)['setup']
        self.assertEqual((state['slot'], state['color'], state['step'], state['pairing']), (2, 5, 'sync', True))
        # 1. Sync: the wheel plugged as XInput #2 holds A+B for 2 s.
        f.pads = [pad(), pad(start=True, finish=True), None, None]
        run(f, .55, 3)
        self.assertEqual(f.setup['step'], 'confirm')
        self.assertEqual(f.pad_map[1], 1)
        # 2. Confirm: both sides and both pedals, in any order.
        for t, reading in ((3.1, pad(steering=-80)), (3.2, pad(steering=90)), (3.3, pad(throttle=100))):
            f.pads = [pad(), reading, None, None]; run(f, t, t + .05)
        self.assertEqual(f.setup['step'], 'confirm')
        self.assertEqual(f.summary(3.4)['setup']['seen'], dict(left=True, right=True, throttle=True, brake=False))
        f.pads = [pad(), pad(brake=100), None, None]; run(f, 3.45, 3.5)
        # 3. Comms: slot 2 already has board BBB answering -> configured.
        self.assertIsNone(f.setup)
        self.assertEqual(f.available, 2)
        self.assertIn('Vaga 02 VERDE: controle configurado', f.events[0]['text'])
        self.assertFalse(f.summary(3.5)['slots'][1]['blocked'])
        f2 = fleet_with([], {}, settings)  # remembered after a restart
        self.assertEqual((f2.available, f2.slots[1].name), (2, 'VERDE'))

    def test_setup_waits_for_the_board_and_can_be_cancelled(self):
        f = fleet_with([], {})
        self.assertTrue(f.setup_start(3, 0))
        f.setup['step'] = 'comms'; run(f, .05, .5)
        self.assertEqual(f.setup['step'], 'comms')  # no board yet: keeps waiting
        f.setup_cancel()
        self.assertIsNone(f.setup)
        self.assertEqual(f.available, 1)
        f.available = 4
        self.assertFalse(f.setup_start(7, 1))  # every slot the server has is configured

    def test_the_number_of_cockpits_is_a_parameter(self):
        f = Fleet(cockpits=8)
        self.assertEqual(len(f.slots), 8)
        self.assertEqual((f.summary(0)['cockpits'], f.summary(0)['capacity'], len(f.summary(0)['slots'])), (8, 4, 8))
        self.assertEqual(f.slots[7].name, 'ROSA')  # slot 8 defaults to color 8
        self.assertEqual(f.slot(8).number, 8)
        self.assertIsNone(f.slot(9))
        f.available = 4
        self.assertFalse(f.setup_start(9, 0))  # XInput: no wheel channel for a 5th slot yet
        f.wheels = 16  # e.g. DirectInput later: then slot 5 can be added
        self.assertTrue(f.setup_start(9, 0))
        settings = History()
        settings.set_setting('cockpits', '12')
        self.assertEqual(len(Fleet(settings=settings).slots), 12)  # saved configuration
        self.assertEqual(len(Fleet(cockpits=40).slots), 16)  # never above the 16 colors

    def test_two_cockpits_can_pair_any_xinput_wheel(self):
        f = fleet_with([], {})
        f2 = Fleet(cockpits=2)
        self.assertEqual(len(f2.pads), 4)  # four XInput channels even with two cockpits
        f2.pair(2, 0)
        f2.pads = [None, None, None, pad(start=True, finish=True)]  # wheel on XInput #4
        run(f2, .05, 2.5)
        self.assertEqual(f2.pad_map, [0, 3])

    def test_wheel_sync_can_be_cancelled_and_expires(self):
        f = fleet_with([], {})
        f.pair(2, 0); f.pair(0, 1)
        self.assertIsNone(f.pairing)  # cancelled
        f.pair(2, 2); run(f, 2.05, 33)
        self.assertIsNone(f.pairing)  # expired after 30 s

    def test_battery_counts_time_while_marked_on_and_survives_a_restart(self):
        settings = History()
        f = fleet_with([], {}, settings)
        run(f, 0, 1)
        self.assertEqual(f.summary(1)['slots'][0]['battery'],
                         dict(on=False, usedMs=0, capacityMs=30 * 60 * 1000, percent=100, alert='ok'))
        f.battery(1, 'on', 1); run(f, 1.05, 61)
        f.battery(1, 'off', 61); run(f, 61.05, 120)  # off: no longer counts
        self.assertAlmostEqual(f.slots[0].battery_used, 60, delta=.1)
        f.battery(1, 'on', 120); run(f, 120.05, 130)
        f2 = fleet_with([], {}, settings)  # app reopened: same use, still on
        self.assertAlmostEqual(f2.slots[0].battery_used, 70, delta=.1)
        self.assertTrue(f2.slots[0].battery_on)
        f2.battery(1, 'new', 0)
        self.assertEqual(f2.slots[0].battery_used, 0)
        self.assertIn('bateria nova', f2.events[0]['text'])
        self.assertFalse(f2.battery(9, 'on', 0) or f2.battery(1, 'boom', 0))

    def test_battery_alerts_at_20_10_and_5_percent(self):
        f = fleet_with([], {})
        slot = f.slots[0]
        for used_minutes, percent, alert in ((23.9, 20, 'low'), (23, 23, 'ok'), (27, 10, 'critical'),
                                             (28.5, 5, 'stop'), (40, 0, 'stop')):
            slot.battery_used = used_minutes * 60
            state = f.summary(0)['slots'][0]['battery']
            self.assertEqual((state['percent'], state['alert']), (percent, alert), used_minutes)
        f.battery(1, 'new', 0)  # "zerar": full charge again
        self.assertEqual(f.summary(0)['slots'][0]['battery']['alert'], 'ok')

    def test_battery_at_5_percent_blocks_the_start_until_zeroed(self):
        f = fleet_with(['COM3'], {'COM3': 'AAA'})
        f.set_auto_test(False)
        f.pads = [pad(), None, None, None]
        f.slots[0].battery_used = 28.6 * 60  # 5% left
        run(f, 0, .5)
        car = f.summary(.5)['slots'][0]
        self.assertTrue(car['blocked'])
        self.assertIn('não pode rodar', car['status'])
        self.assertEqual(f.start_all(.5), [])  # LARGAR TODOS skips it
        f.pads = [pad(start=True), None, None, None]; run(f, .55, 1)  # wheel A too
        self.assertEqual(f.slots[0].controller.phase, 'idle')
        f.battery(1, 'new', 1)  # battery replaced and zeroed
        f.pads = [pad(), None, None, None]; run(f, 1.05, 1.2)
        self.assertFalse(f.summary(1.2)['slots'][0]['blocked'])
        self.assertEqual(f.start_all(1.2), [1])

    def test_one_naming_of_the_cars_in_server_and_screens(self):
        import pathlib, re
        from backend.fleet import CAR_NAMES
        slots_ts = pathlib.Path(__file__).resolve().parent.parent / 'frontend' / 'src' / 'slots.ts'
        self.assertEqual(tuple(re.findall(r'name: "([^"]+)"', slots_ts.read_text(encoding='utf-8'))), CAR_NAMES)
        self.assertEqual([s.name for s in Fleet().slots], list(CAR_NAMES[:4]))

    def test_battery_switches_on_by_itself_when_the_race_starts(self):
        f = fleet_with(['COM3'], {'COM3': 'AAA'})
        f.set_auto_test(False)
        run(f, 0, .5)
        self.assertFalse(f.slots[0].battery_on)
        f.pads = [pad(), None, None, None]
        f.start_all(.5); run(f, .55, 10.5)
        self.assertTrue(f.slots[0].battery_on)
        self.assertAlmostEqual(f.slots[0].battery_used, 10, delta=.2)


if __name__ == '__main__':
    unittest.main()
