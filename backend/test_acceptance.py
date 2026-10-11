import asyncio
import unittest

from backend.fleet import ACCEPTANCE_BLOCK, EMERGENCY_BLOCK
from backend.server import Server
from backend.test_control import FakeSerial, pad
from backend.test_fleet import Car, fleet_with, run


def ready(ports=('COM3',), ids=None):
    f = fleet_with(list(ports), ids or {'COM3': 'AAA'})
    f.set_auto_test(False)
    run(f, 0, .5)
    return f


def accept(f, t=1.0, number=1, camera=30, audio=True, area=True, until=None, seen=None):
    """Runs the whole acceptance like an operator: turns the wheel, presses the pedals,
    confirms the area, and answers the camera and audio checks. Returns the time it ended."""
    slot = f.slot(number)
    acc = slot.acceptance
    f.acceptance_start(number, None, t)
    while acc.running and t < 200:
        if until and until(acc): break
        current, phase = acc.current, int(t * 4) % 4
        reading = pad()
        if current == 'steering': reading = pad(steering=(-100, 100, 0, 0)[phase])
        elif current == 'pedals': reading = pad(throttle=100 if phase == 1 else 0, brake=100 if phase == 3 else 0)
        f.pads[f.pad_map[number - 1]] = reading
        waiting = acc.waiting()
        if waiting == 'area' and area: f.acceptance_area(number, t)
        elif waiting == 'camera': f.acceptance_report(number, 'camera', dict(ok=camera is not None, fps=camera or 0,
                                                                            width=1920, height=1080), t)
        elif waiting == 'audio': f.acceptance_report(number, 'audio', dict(ok=audio), t)
        t = round(t + .05, 3)
        f.step(t)
        if seen is not None: seen.append((slot.controller.phase, slot.controller.mask))
    return t


class AcceptanceTests(unittest.TestCase):
    def test_full_acceptance_releases_the_car_and_tests_one_relay_at_a_time(self):
        f = ready()
        seen = []
        accept(f, seen=seen)
        acc = f.slots[0].acceptance
        self.assertTrue(acc.released())
        self.assertEqual([acc.items[k]['status'] for k in acc.items], ['passed'] * 7)
        self.assertIn('4/4', acc.items['actuators']['message'])
        self.assertIn('ms', acc.items['emergency']['message'])
        self.assertIn('COM3', acc.items['communication']['message'])
        # Relays: only during the relay checks, one at a time, never two opposite ones.
        test_masks = {mask for phase, mask in seen if phase == 'test'}
        self.assertEqual(test_masks - {0}, {1, 2, 4, 8})
        self.assertFalse(any(phase in ('starting', 'countdown', 'running') for phase, _ in seen))  # pedals never start it
        self.assertEqual(acc.finished[0]['result'], 'passed')
        summary = f.summary(acc.since)['slots'][0]
        self.assertEqual(summary['acceptance']['passed'], 7)
        self.assertEqual(summary['unitId'], 'RC-01')
        self.assertEqual(summary['link']['port'], 'COM3')
        self.assertIn('UNIDADE APTA', summary['log'][0]['message'])

    def test_open_event_blocks_the_start_until_the_acceptance_passes(self):
        f = ready()
        f.acceptance_required = True
        run(f, .55, .7)
        c = f.slots[0].controller
        self.assertFalse(c.start_countdown(.7))
        self.assertEqual(c.reason, ACCEPTANCE_BLOCK)
        self.assertEqual(f.summary(.7)['slots'][0]['state'], 'WARNING')
        t = accept(f)
        self.assertEqual(f.summary(t)['slots'][0]['state'], 'READY')
        self.assertEqual(f.start_all(t), [1])
        # Practice (no event): no acceptance needed.
        g = ready()
        run(g, .55, .7)
        self.assertEqual(g.start_all(.7), [1])

    def test_camera_below_minimum_is_a_fault_but_failed_audio_does_not_block(self):
        f = ready()
        f.acceptance_required = True
        t = accept(f, camera=10)
        acc = f.slots[0].acceptance
        self.assertEqual(acc.items['camera']['status'], 'failed')
        self.assertFalse(acc.released())
        self.assertEqual(f.summary(t)['slots'][0]['state'], 'FAULT')
        self.assertEqual(f.summary(t)['slots'][0]['acceptance']['criticalFailed'], ['camera'])
        g = ready()
        g.acceptance_required = True
        t = accept(g, audio=False, camera=18)  # 18 FPS: passes with a warning
        acc = g.slots[0].acceptance
        self.assertEqual(acc.items['audio']['status'], 'failed')
        self.assertIn('ATENÇÃO', acc.items['camera']['message'])
        self.assertTrue(acc.released())
        self.assertEqual(g.start_all(t), [1])

    def test_relays_wait_for_area_free_and_fail_without_it(self):
        f = ready()
        accept(f, area=False)
        acc = f.slots[0].acceptance
        self.assertEqual(acc.items['actuators']['status'], 'failed')
        self.assertIn('Área livre', acc.items['actuators']['message'])

    def test_emergency_check_fails_when_the_board_does_not_confirm_relays_off(self):
        f = ready()
        t = accept(f, until=lambda a: a.current == 'emergency')
        f.boards['COM3'].link.ignore = {0}  # the board never confirms "all off"
        accept_rest = f.slots[0].acceptance
        while accept_rest.current == 'emergency' and t < 30:
            t = round(t + .05, 3); f.step(t)
        self.assertEqual(accept_rest.items['emergency']['status'], 'failed')

    def test_what_invalidates_an_acceptance(self):
        # The board restarts (hello again).
        f = ready()
        t = accept(f)
        f.boards['COM3'].link.buffer += b'Pronto CONTROLE v6 ID AAA\nESTADO 0\n'
        run(f, t + .05, t + .2)
        acc = f.slots[0].acceptance
        self.assertFalse(acc.released())
        self.assertEqual(acc.trigger, 'ESP32_RESTARTED')
        self.assertIn('reiniciou', f.slots[0].log[0]['message'])
        # Another wheel synced to this car.
        f = ready()
        t = accept(f)
        f.pair(1, t)
        f.pads[1] = pad(start=True, finish=True)
        run(f, t + .05, t + 2.3)
        self.assertEqual(f.slots[0].acceptance.trigger, 'CONTROLLER_CHANGED')
        # Another car (board) in this slot.
        f = ready(('COM3', 'COM4'), {'COM3': 'AAA', 'COM4': 'BBB'})
        t = accept(f)
        f.assign('COM4', 1)
        self.assertEqual(f.slots[0].acceptance.trigger, 'VEHICLE_CHANGED')
        # The board silent for a long time.
        f = ready()
        t = accept(f)
        f.boards['COM3'].link.respond = False
        run(f, t + .05, t + 3)
        self.assertTrue(f.slots[0].acceptance.released())  # a short loss keeps it
        run(f, t + 3.05, t + 7)
        self.assertEqual(f.slots[0].acceptance.trigger, 'COMMUNICATION_RESET')

    def test_emergency_stop_latches_until_reset_and_needs_a_new_acceptance(self):
        f = ready()
        f.acceptance_required = True
        t = accept(f)
        f.start_all(t)
        f.emergency(1)
        run(f, t + .05, t + .2)
        c = f.slots[0].controller
        self.assertEqual((c.phase, c.mask), ('idle', 0))
        self.assertEqual(c.reason, EMERGENCY_BLOCK)
        self.assertEqual(f.summary(t)['slots'][0]['state'], 'EMERGENCY_STOP')
        self.assertFalse(f.acceptance_start(1, None, t + .2))  # nothing runs before RESET
        self.assertEqual(f.start_all(t + .2), [])
        f.emergency_reset(1)
        run(f, t + .25, t + .3)
        self.assertEqual(c.reason, ACCEPTANCE_BLOCK)
        self.assertEqual(f.slots[0].acceptance.trigger, 'TECHNICAL_INTERVENTION')
        t = accept(f, t=t + .35)
        self.assertEqual(f.start_all(t), [1])

    def test_single_check_and_cancel(self):
        f = ready()
        self.assertTrue(f.acceptance_start(1, ['communication'], 1))
        run(f, 1.05, 2.5)
        acc = f.slots[0].acceptance
        self.assertEqual(acc.items['communication']['status'], 'passed')
        self.assertEqual(acc.items['steering']['status'], 'idle')
        self.assertFalse(acc.released())
        f.acceptance_start(1, ['actuators'], 2.5)
        run(f, 2.55, 2.6)
        self.assertEqual(acc.waiting(), 'area')
        f.acceptance_area(1, 2.6)
        run(f, 2.65, 3.2)
        self.assertEqual(f.slots[0].controller.phase, 'test')
        f.acceptance_cancel(1)
        run(f, 3.25, 3.3)
        self.assertEqual((f.slots[0].controller.phase, f.slots[0].controller.mask), ('idle', 0))
        self.assertEqual(acc.items['actuators']['status'], 'failed')

    def test_invalidated_during_the_relay_check_switches_the_relays_off(self):
        f = ready()
        t = accept(f, until=lambda a: a.current == 'actuators' and a.stage == 'run')
        run(f, t + .05, t + .3)
        self.assertEqual(f.slots[0].controller.phase, 'test')
        f.invalidate(f.slots[0], 'TECHNICAL_INTERVENTION', 'teste')
        run(f, t + .35, t + .4)
        self.assertEqual((f.slots[0].controller.phase, f.slots[0].controller.mask), ('idle', 0))


class ServerAcceptanceTests(unittest.TestCase):
    def test_full_run_is_saved_and_a_new_event_asks_for_it_again(self):
        Car.ids = {'COM7': 'AAA'}
        server = Server(serial_factory=lambda port, *a, **k: Car(port), ports=lambda: ['COM7'], xinput=False)
        f = server.fleet
        f.set_auto_test(False)
        f.scan(0, ['COM7'])
        run(f, 0, .5)
        self.assertTrue(server.operator_command('acceptanceStart', dict(slot=1)))
        t = accept(f, t=.55)
        asyncio.run(server.save_acceptances(f.slots[0]))
        saved = server.history.acceptances()
        self.assertEqual((saved[0]['slot'], saved[0]['boardId'], saved[0]['result']), (1, 'AAA', 'passed'))
        self.assertEqual(saved[0]['items']['actuators']['status'], 'passed')
        server.open_event('Fortaleza')
        self.assertTrue(f.acceptance_required)
        self.assertEqual(f.slots[0].acceptance.trigger, 'EVENT_START')
        run(f, t, t + .1)
        self.assertEqual(f.slots[0].controller.reason, ACCEPTANCE_BLOCK)
        server.operator_command('emergency', dict(slot=1))
        self.assertTrue(f.slots[0].emergency)
        server.operator_command('emergencyReset', dict(slot=1))
        self.assertFalse(f.slots[0].emergency)

    def test_simulated_server_passes_the_camera_by_itself(self):
        from backend.simulated import AutoPilot
        server = Server(serial_factory=lambda *a, **k: FakeSerial(), ports=lambda: ['COM7'], xinput=False, autopilot=AutoPilot())
        self.assertTrue(server.fleet.simulated_camera)


if __name__ == '__main__': unittest.main()
