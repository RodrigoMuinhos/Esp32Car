import unittest
from backend.control import Controller
from backend.server import Bridge
import serial

def pad(steering=0, throttle=0, brake=0, start=False, finish=False):
    return dict(steering=steering, throttle=throttle, brake=brake, start=start, finish=finish)

class ControllerTests(unittest.TestCase):
    def setUp(self): self.c = Controller(); self.c.connected = True
    def run_for(self, t0, t1, **inp):
        t = t0
        while t <= t1 + 1e-9: self.c.tick(round(t, 3), pad(**inp)); t += .05
    def start(self, t=0):
        self.c.tick(t, pad()); self.c.tick(t + .05, pad(start=True)); self.c.tick(t + .1, pad())
        self.assertEqual(self.c.phase, 'running')
    def test_button_a_starts_and_b_finishes(self):
        self.c.tick(0, pad()); self.c.tick(.05, pad(start=True, throttle=100, steering=-50))
        self.assertEqual(self.c.phase, 'running'); self.assertEqual(self.c.mask, 9); self.assertEqual(self.c.race_id, 1)
        self.c.tick(.1, pad(finish=True, throttle=100))
        self.assertEqual(self.c.phase, 'finished'); self.assertEqual(self.c.mask, 0)
        self.assertEqual(self.c.reason, 'Corrida finalizada pelo botão B.')
    def test_pedals_never_start_the_race(self):
        self.run_for(0, 5, throttle=100); self.assertEqual(self.c.phase, 'idle'); self.assertEqual(self.c.mask, 0)
        self.run_for(5.05, 6, brake=100); self.assertEqual(self.c.phase, 'idle')
    def test_no_automatic_finish(self):
        self.start(); self.run_for(.15, 30, brake=100)  # long brake and no throttle for 30 s
        self.assertEqual(self.c.phase, 'running'); self.assertEqual(self.c.mask, 2)
    def test_holding_a_does_not_restart_and_b_does_nothing_when_stopped(self):
        self.start(); self.c.tick(.15, pad(finish=True)); self.assertEqual(self.c.phase, 'finished')
        self.run_for(.2, 1, start=True)  # pressed once, held
        self.assertEqual(self.c.phase, 'running'); self.assertEqual(self.c.race_id, 2)
        self.c.message(dict(type='stop', data={}), 1.05); self.run_for(1.1, 2, start=True)
        self.assertEqual(self.c.phase, 'finished')
        self.c.tick(2.05, pad()); self.c.tick(2.1, pad(finish=True)); self.assertEqual(self.c.phase, 'finished')
    def test_wheel_loss_stops(self):
        self.start(); self.c.tick(.2, None); self.assertEqual(self.c.mask, 0); self.assertFalse(self.c.enabled)
    def test_panel_input_fallback_and_timeout(self):
        send = lambda t, **k: self.c.message(dict(type='control', data=pad(**k)), t)
        send(0); self.c.tick(0); send(.05, start=True, throttle=100); self.c.tick(.05)
        self.assertEqual(self.c.phase, 'running'); self.assertEqual(self.c.mask, 1)
        self.c.tick(.6); self.assertEqual(self.c.mask, 0)
        send(1, throttle=float('nan')); self.assertEqual(self.c.mask, 0)
    def test_opposing_relays_and_hysteresis(self):
        self.start(); self.c.tick(2.1, pad(throttle=100, brake=100, steering=40)); self.assertEqual(self.c.mask, 4)
        self.c.tick(2.2, pad(throttle=50, steering=10)); self.assertEqual(self.c.mask, 5)
        self.c.tick(2.3, pad(throttle=50, steering=7)); self.assertEqual(self.c.mask, 1)
    def test_pulse_expires_and_is_rejected_while_racing(self):
        self.c.message(dict(type='relay', data=dict(relay=3)), 10); self.c.tick(10.49, pad())
        self.assertEqual(self.c.mask, 4); self.c.tick(10.5, pad()); self.assertEqual(self.c.mask, 0)
        self.start(11); self.c.message(dict(type='relay', data=dict(relay=1)), 11.2)
        self.assertEqual(self.c.phase, 'running')

class FakeSerial:
    def __init__(self, *args, **kwargs):
        self.buffer = b'Pronto CONTROLE v5\nESTADO 0\n'
        self.writes = []; self.respond = True
    def read(self, _): out = self.buffer; self.buffer = b''; return out
    def write(self, data):
        self.writes.append(data)
        if self.respond:
            for c in data:
                if 97 <= c <= 112: self.buffer += f'ESTADO {c - 97}\n'.encode()
                elif c == ord('S'): self.buffer += b'ESTADO 0\n'
                elif c == ord('?'): self.buffer += b'Pronto CONTROLE v5\n'
    def close(self): pass

class SerialTests(unittest.TestCase):
    def test_auto_detect_prefers_esp32_and_skips_bluetooth(self):
        from unittest import mock
        from types import SimpleNamespace as P
        ports = [P(device='COM5', vid=None, hwid='BTHENUM\X'), P(device='COM9', vid=0x2341, hwid='USB'),
                 P(device='COM7', vid=0x10C4, hwid='USB VID:PID=10C4:EA60')]
        with mock.patch('backend.server.list_ports.comports', return_value=ports):
            from backend.server import find_ports
            self.assertEqual(find_ports(), ['COM7', 'COM9'])
    def test_mask_is_only_reported_after_serial_confirmation(self):
        b = Bridge('COM7'); b.port = FakeSerial(); b.opened = 10
        b.pump(10); self.assertTrue(b.controller.connected); self.assertEqual(b.confirmed, 0)
        b.controller.message(dict(type='relay', data=dict(relay=4)), 10.01); b.pump(10.02)
        self.assertEqual(b.confirmed, 0); self.assertEqual(b.port.writes[-1], b'i')
        b.pump(10.04); self.assertEqual(b.confirmed, 8)
    def test_missing_ack_faults_and_disconnect_sends_stop(self):
        b = Bridge('COM7'); p = FakeSerial(); b.port = p; b.opened = 10
        b.pump(10); p.respond = False; p.buffer = b''
        with self.assertRaises(serial.SerialException): b.pump(10.8)
        b.disconnect('lost'); self.assertFalse(b.controller.connected)
        self.assertIsNone(b.confirmed); self.assertEqual(p.writes[-1], b'S')

if __name__ == '__main__': unittest.main()
