"""Four cars racing at once: plug & play boards, wheels and the 4 color slots.

Each slot (01 AZUL ELÉTRICO, 02 LARANJA, 03 VERMELHO, 04 ROXO) owns a race Controller,
a wheel (XInput index) and, when plugged in, a board (an ESP32 on a COM port).

Boards are found by themselves: every new serial port is opened and asked
"?"; an ESP32 with the RC Racing firmware answers "Pronto CONTROLE v6 ID <id>"
(v5 boards have no ID and are known by their port). A board seen before goes
back to its slot; a new one fills an empty slot, or replaces the only car that
is missing (a broken car swapped for a spare). Every board runs the relay
self-test when it arrives. All decisions are pure and time is injectable, so
the whole fleet is testable without hardware.
"""
import contextlib
import re
import time
from collections import deque
from datetime import datetime

import serial

from backend.acceptance import CRITICAL, LABELS, Acceptance
from backend.control import PEDAL_ON, STEER_ON, Controller

# The one naming of the cars, in every screen and message (frontend/src/slots.ts has the
# same list with the colors; test_fleet checks they match). Slots 1-4 exist today.
CAR_NAMES = ('AZUL ELÉTRICO', 'LARANJA', 'VERMELHO', 'ROXO', 'VERDE', 'AMARELO OURO', 'CIANO', 'ROSA',
             'AZUL MARINHO', 'LIMA', 'CORAL', 'VIOLETA', 'TURQUESA', 'ÂMBAR', 'MAGENTA', 'ÍNDIGO')
# How many cockpits the installation has: a parameter (setting 'cockpits' or --cockpits),
# never assumed to be 4. Wheel channels are separate: XInput gives at most 4 wheels.
DEFAULT_COCKPITS = 4
MAX_COCKPITS = len(CAR_NAMES)
XINPUT_WHEELS = 4
SLOTS = tuple((n, CAR_NAMES[n - 1]) for n in range(1, DEFAULT_COCKPITS + 1))
HELLO = re.compile(r'^Pronto CONTROLE v(\d+)(?:\s+ID\s+([0-9A-Za-z:_-]+))?$')
ACK_TIMEOUT = .75
HELLO_TIMEOUT = 8.0
RETRY_BAD_PORT = 15.0
PAIRING_TIMEOUT = 30.0
AVAILABLE_DEFAULT = 1  # slots configured at first; the next ones are added with the setup wizard
UNCONFIGURED = 'Vaga não configurada: use + ADICIONAR CONTROLE na Visão Mecânico.'
# Setup wizard, step 'confirm': the wheel must reach these (steering -100..100, pedals 0..100).
CONFIRM_STEERING, CONFIRM_PEDAL = 60, 80
SYNC_HOLD = 2.0  # wheel sync: A and B held together this long
WRITE_EVERY = .15
BATTERY_SECONDS = 30 * 60  # one charge of a car battery, in use
BATTERY_SAVE_EVERY = 10.0
# Charge left (%) that raises each alert: replace soon, replace now, must not run.
BATTERY_LOW, BATTERY_CRITICAL, BATTERY_STOP = 20, 10, 5
BATTERY_BLOCK = 'Bateria em 5% ou menos: não pode rodar. Troque a bateria e zere o contador.'
EMERGENCY_BLOCK = 'PARADA DE EMERGÊNCIA acionada: aperte RESET na Central Técnica e refaça o aceite.'
ACCEPTANCE_RUNNING = 'Aceite técnico em andamento.'
ACCEPTANCE_BLOCK = 'Aceite técnico pendente: rode INICIAR ACEITAÇÃO na Central Técnica.'
COMM_LOSS = 5.0  # board silent this long: the acceptance must be done again
LATE_ACK = .3  # a confirmation that took longer than this counts as late
LOG_SIZE = 40  # entries kept per car (Central Técnica)
LOG_SHOWN = 12


class Board:
    """One ESP32 on one serial port: handshake, confirmations and relay output."""

    def __init__(self, port, link, now):
        self.port = port
        self.link = link
        self.buffer = b''
        self.hello = False
        self.firmware = None
        self.board_id = None
        self.confirmed = None
        self.opened = self.last_ack = self.last_match = now
        self.last_write = 0.0
        self.sent_mask = -1
        self.spare = Controller()  # follows this while the board has no slot
        self.controller = self.spare
        self.slot = None
        self.tested = False
        self.test = dict(running=False, results=[None] * 4, interrupted=False)
        # Link health for the Central Técnica: time from a new command to its ESTADO,
        # recent confirmations, late ones, and board restarts (hello again).
        self.pending = None  # (mask, sent at) waiting for its confirmation
        self.confirm_ms = None
        self.acks = deque(maxlen=64)
        self.late = 0
        self.restarts = 0
        self.restarted = False

    def alive(self, now):
        return self.hello and self.confirmed is not None and now - self.last_ack < ACK_TIMEOUT

    def read(self, now):
        self.buffer += self.link.read(4096)
        while b'\n' in self.buffer:
            line, self.buffer = self.buffer.split(b'\n', 1)
            text = line.decode('utf-8', errors='replace').strip()
            hello = HELLO.match(text)
            if hello:
                if self.hello:
                    self.restarts += 1; self.restarted = True
                    if self.controller.phase != 'idle': self.controller.stop('ESP32 reiniciou. Inicie novamente.')
                self.hello = True
                self.firmware = int(hello.group(1))
                self.board_id = hello.group(2) or f'PORTA-{self.port}'
            elif text.startswith('ESTADO '):
                try: mask = int(text.split()[1])
                except (ValueError, IndexError): continue
                if not 0 <= mask <= 15 or mask & 3 == 3 or mask & 12 == 12: continue
                if self.confirmed is not None and now - self.last_ack > LATE_ACK: self.late += 1
                if self.pending and mask == self.pending[0]:
                    self.confirm_ms = round((now - self.pending[1]) * 1000); self.pending = None
                self.confirmed = mask; self.last_ack = now; self.acks.append(now)
                if self.controller.phase == 'selftest' and mask in (1, 2, 4, 8):
                    self.test['results'][mask.bit_length() - 1] = True
                if mask == self.controller.mask: self.last_match = now
        if len(self.buffer) > 8192: self.buffer = b''
        if self.hello and self.confirmed is not None and now - self.last_ack >= ACK_TIMEOUT:
            raise serial.SerialException('ESP32 sem confirmação.')
        if not self.alive(now) and now - self.opened > HELLO_TIMEOUT:
            raise serial.SerialException('Não é uma placa RC Racing.')

    def write(self, now):
        desired = self.controller.mask if self.alive(now) else 0
        if desired != self.sent_mask:
            self.last_match = now
            if self.hello: self.pending = (desired, now)
        elif self.alive(now) and now - self.last_match >= ACK_TIMEOUT:
            raise serial.SerialException('Relés não confirmaram o comando.')
        if desired != self.sent_mask or now - self.last_write >= WRITE_EVERY:
            self.link.write(bytes([ord('a') + desired]) if self.hello else b'?S')
            self.sent_mask = desired; self.last_write = now

    def rate(self, now):
        """Confirmations per second (last second)."""
        return sum(1 for t in self.acks if now - t <= 1.0)

    def max_gap(self, now, window=1.0):
        """Longest wait between confirmations in the last second (the current wait included)."""
        times = [t for t in self.acks if now - t <= window]
        if not times: return None
        return max([now - times[-1]] + [b - a for a, b in zip(times, times[1:])])

    def close(self):
        with contextlib.suppress(Exception): self.link.write(b'S')
        with contextlib.suppress(Exception): self.link.close()


class Slot:
    def __init__(self, number, name=None):
        self.number = number
        self.color = number  # 1..16 in CAR_NAMES; chosen in the setup wizard
        self.controller = Controller()
        self.board_id = None  # board assigned to this color (persisted)
        self.driver = f'Piloto {number:02d}'
        self.last_result = None
        self.consumed_start = False  # A+B used to sync the wheel: ignore them until released
        # Battery: the board sits on the remote control, so the operator marks when
        # the car is switched on; time in use adds up while it is marked on.
        self.battery_on = False
        self.battery_used = 0.0  # seconds used of the current charge
        self.battery_mark = None  # last time the use was added up (None: from the next tick)
        self.battery_saved = 0.0
        # Lap bookkeeping for the history (set by the server): race being saved, laps saved,
        # and the last lap with its flags (personal best, event record) for the screens.
        self.race_key = None
        self.race_row = None
        self.saved_laps = 0
        self.last_lap = None
        # Central Técnica: acceptance, emergency latch, link history and the car's log.
        self.acceptance = Acceptance()
        self.emergency = False
        self.reconnects = 0
        self.offline_since = None
        self.log = deque(maxlen=LOG_SIZE)
        self.late_seen = 0
        self.acc_seen = {}  # acceptance statuses already written to the log
        self.acc_run_seen = None

    @property
    def name(self):
        """The car is named by its color, in every screen and message."""
        return CAR_NAMES[self.color - 1]


class Fleet:
    def __init__(self, serial_factory=serial.Serial, ports=None, settings=None, cockpits=None, wheels=XINPUT_WHEELS):
        """ports(): list of candidate COM ports. settings: object with setting(key, default)/set_setting(key, value).
        cockpits: how many slots (default: the 'cockpits' setting, else 4). wheels: wheel input channels."""
        self.serial_factory = serial_factory
        self.list_ports = ports or (lambda: [])
        self.settings = settings
        if cockpits is None and settings:
            saved = str(settings.setting('cockpits', '') or '')
            cockpits = int(saved) if saved.isdigit() else None
        self.cockpits = max(1, min(MAX_COCKPITS, cockpits or DEFAULT_COCKPITS))
        self.wheels = wheels
        self.pad_count = max(self.cockpits, wheels)  # wheel readings, indexed by input channel
        self.slots = [Slot(n) for n in range(1, self.cockpits + 1)]
        self.boards = {}  # port -> Board
        self.bad_ports = {}  # port -> time it may be tried again
        self.pads = [None] * self.pad_count  # live wheel readings (dict with axes and buttons) or None
        self.pad_sync_since = [None] * self.pad_count  # when each wheel started holding A+B
        self.pad_map = list(range(self.cockpits))  # slot index -> wheel input channel
        self.pairing = None  # (slot number, deadline) while waiting for wheel A
        self.auto_test = True
        self.available = AVAILABLE_DEFAULT
        # Setup wizard of the next slot: dict(slot, step, seen) or None.
        self.setup = None
        self.last_paired = None  # slot number of the last successful wheel sync
        self.events = []  # recent plain-language messages for the operator
        # Set by the server: acceptance required to start (an event is open), and
        # whether the camera check passes by itself (simulated test server).
        self.acceptance_required = False
        self.simulated_camera = False
        # Finishing order of the current start (time trial completed), for the champion.
        self.finish_order = []
        self.load()

    # ---------- persistence ----------
    def load(self):
        if not self.settings: return
        for slot in self.slots:
            color = self.settings.setting(f'slot{slot.number}_color', '')
            if color.isdigit() and 1 <= int(color) <= len(CAR_NAMES): slot.color = int(color)
            slot.board_id = self.settings.setting(f'slot{slot.number}_board') or None
            slot.driver = self.settings.setting(f'slot{slot.number}_driver', slot.driver)
        saved = (self.settings.setting('pad_map') or '').split(',')
        if (len(saved) == self.cockpits and all(i.isdigit() and int(i) < self.pad_count for i in saved)
                and len(set(saved)) == len(saved)):
            self.pad_map = [int(i) for i in saved]
        self.auto_test = self.settings.setting('auto_test', '1') == '1'
        saved = self.settings.setting('available_slots', str(AVAILABLE_DEFAULT))
        self.available = int(saved) if saved.isdigit() and 1 <= int(saved) <= len(self.slots) else AVAILABLE_DEFAULT
        for slot in self.slots:
            try: slot.battery_used = max(0.0, float(self.settings.setting(f'slot{slot.number}_battery_used', '0') or 0))
            except ValueError: slot.battery_used = 0.0
            # Still on when the app closed: keeps counting from now (the closed time is unknown).
            slot.battery_on = self.settings.setting(f'slot{slot.number}_battery_on', '0') == '1'

    def save(self, key, value):
        if self.settings: self.settings.set_setting(key, '' if value is None else value)

    def note(self, text):
        self.events = ([dict(at=time.time(), text=text)] + self.events)[:8]

    def log(self, slot, severity, source, message):
        """One line of a car's log (Central Técnica): info, success, warning or error."""
        slot.log.appendleft(dict(at=datetime.now().astimezone().isoformat(timespec='milliseconds'),
                                 severity=severity, source=source, message=message))

    def invalidate(self, slot, trigger, why):
        if slot.acceptance.invalidate(trigger):
            self.log(slot, 'warning', 'Aceite', f'Aceite invalidado: {why}.')

    # ---------- lookups ----------
    def slot(self, number):
        return self.slots[number - 1] if isinstance(number, int) and 1 <= number <= len(self.slots) else None

    def board_of(self, slot):
        return next((b for b in self.boards.values() if b.slot is slot), None)

    # ---------- boards ----------
    def scan(self, now, ports=None):
        """Opens serial ports that appeared (call from a thread: opening can block)."""
        for port in ports if ports is not None else self.list_ports():
            if port in self.boards or self.bad_ports.get(port, 0) > now: continue
            try:
                link = self.serial_factory(port, 115200, timeout=0, write_timeout=.1)
            except (serial.SerialException, OSError):
                self.bad_ports[port] = now + RETRY_BAD_PORT; continue
            self.boards[port] = Board(port, link, now)

    def drop(self, board, reason, now):
        board.close()
        self.boards.pop(board.port, None)
        if board.slot:
            board.slot.controller.connected = False
            board.slot.controller.stop(f'Carrinho {board.slot.name} desconectado ({reason})')
            self.note(f'Vaga {board.slot.number:02d} {board.slot.name}: carrinho desconectado.')
            board.slot.reconnects += 1
            self.log(board.slot, 'error', 'Placa', f'Placa desconectada ({reason}).')
        if not board.hello: self.bad_ports[board.port] = now + RETRY_BAD_PORT

    def attach(self, board, slot, why):
        old = self.board_of(slot)
        if old and old is not board:
            old.slot = None; old.controller = old.spare
        if board.slot and board.slot is not slot:
            board.slot.board_id = None; self.save(f'slot{board.slot.number}_board', None)
        if slot.board_id and slot.board_id != board.board_id: self.invalidate(slot, 'VEHICLE_CHANGED', 'carrinho trocado')
        board.slot = slot; board.controller = slot.controller
        slot.board_id = board.board_id; self.save(f'slot{slot.number}_board', board.board_id)
        self.log(slot, 'success', 'Placa', f'Placa conectada: {board.board_id} em {board.port} (firmware v{board.firmware}).')
        board.tested = False  # the car that moves in the test is the one now in this color
        self.note(f'Vaga {slot.number:02d} {slot.name}: {why} ({board.board_id}, {board.port}).')

    def place(self, board):
        """Where a board that just said hello goes."""
        known = next((s for s in self.slots if s.board_id == board.board_id), None)
        if known and not self.board_of(known):
            return self.attach(board, known, 'carrinho reconectado')
        fresh = next((s for s in self.slots if not s.board_id), None)
        if fresh: return self.attach(board, fresh, 'carrinho novo')
        orphans = [s for s in self.slots if not self.board_of(s)]
        if len(orphans) == 1: return self.attach(board, orphans[0], 'carrinho trocado')
        self.note(f'Carrinho novo ({board.board_id}, {board.port}): escolha a vaga no painel.')

    def assign(self, port, number):
        board, slot = self.boards.get(port), self.slot(number)
        if not board or not slot or not board.hello: return False
        if slot.controller.phase in ('countdown', 'running') or board.controller.phase in ('countdown', 'running'): return False
        if board.controller is not slot.controller: board.controller.stop('Carrinho movido de vaga.')
        self.attach(board, slot, 'carrinho escolhido pelo operador')
        return True

    def release(self, number):
        slot = self.slot(number)
        if not slot: return
        board = self.board_of(slot)
        slot.controller.stop('Carrinho liberado da vaga.')
        if board: board.slot = None; board.controller = board.spare
        slot.board_id = None; self.save(f'slot{number}_board', None)

    def self_test(self, board, now):
        if board.controller.start_self_test(now):
            board.test = dict(running=True, results=[None] * 4, interrupted=False)

    def follow_test(self, board, now):
        if not board.alive(now): return
        if self.auto_test and not board.tested and board.controller.phase in ('idle', 'finished'):
            board.tested = True; self.self_test(board, now)
        if board.test['running'] and board.controller.phase != 'selftest':
            done = board.controller.selftest_completed
            board.test = dict(running=False, interrupted=not done,
                              results=[r if r or not done else False for r in board.test['results']])

    # ---------- battery ----------
    def save_battery(self, slot, now):
        slot.battery_saved = now
        self.save(f'slot{slot.number}_battery_used', f'{slot.battery_used:.1f}')
        self.save(f'slot{slot.number}_battery_on', '1' if slot.battery_on else '0')

    def follow_battery(self, slot, now):
        if slot.controller.phase in ('countdown', 'running') and not slot.battery_on:
            self.battery(slot.number, 'on', now)  # racing means the car is on
        if not slot.battery_on: return
        if slot.battery_mark is not None: slot.battery_used += max(0.0, now - slot.battery_mark)
        slot.battery_mark = now
        if now - slot.battery_saved >= BATTERY_SAVE_EVERY: self.save_battery(slot, now)

    def battery_state(self, slot):
        left = max(0.0, BATTERY_SECONDS - slot.battery_used)
        percent = round(100 * left / BATTERY_SECONDS)
        alert = ('stop' if percent <= BATTERY_STOP else 'critical' if percent <= BATTERY_CRITICAL
                 else 'low' if percent <= BATTERY_LOW else 'ok')
        return dict(on=slot.battery_on, usedMs=round(slot.battery_used * 1000),
                    capacityMs=BATTERY_SECONDS * 1000, percent=percent, alert=alert)

    def battery(self, number, action, now):
        """Operator marks: 'on' (car switched on), 'off', 'new' (fresh battery, full charge)."""
        slot = self.slot(number)
        if not slot or action not in ('on', 'off', 'new'): return False
        if slot.battery_on and slot.battery_mark is not None:
            slot.battery_used += max(0.0, now - slot.battery_mark)
        slot.battery_mark = now
        if action == 'new':
            slot.battery_used = 0.0
            self.note(f'Vaga {number:02d} {slot.name}: bateria nova.')
            self.log(slot, 'info', 'Bateria', 'Bateria trocada: contador zerado (100%).')
        else:
            slot.battery_on = action == 'on'
        self.save_battery(slot, now)
        return True

    # ---------- wheels ----------
    def pair(self, number, now):
        """The next wheel that holds A+B for 2 s becomes this slot's wheel (other numbers cancel)."""
        self.pairing = (number, now + PAIRING_TIMEOUT) if self.slot(number) else None

    def pad_input(self, slot):
        pad = self.pads[self.pad_map[slot.number - 1]]
        if pad is None: return None
        # While a wheel is being synced, A/B/Y of every wheel do nothing (X still stops).
        if self.pairing: return dict(pad, start=False, finish=False, lap=False)
        if slot.consumed_start:
            if pad.get('start') or pad.get('finish'): return dict(pad, start=False, finish=False)
            slot.consumed_start = False
        return pad

    def follow_pairing(self, now):
        held = [bool(p and p.get('start') and p.get('finish')) for p in self.pads]
        self.pad_sync_since = [(since if since is not None else now) if hit else None
                               for hit, since in zip(held, self.pad_sync_since)]
        if not self.pairing: return
        number, deadline = self.pairing
        if now > deadline: self.pairing = None; return
        asked = deadline - PAIRING_TIMEOUT  # a hold only counts from the moment sync was asked
        index = next((i for i, since in enumerate(self.pad_sync_since)
                      if since is not None and now - max(since, asked) >= SYNC_HOLD), None)
        if index is None: return
        slot = self.slot(number)
        if index in self.pad_map:  # that wheel had another slot: the two swap
            other = self.pad_map.index(index)
            if other != number - 1: self.invalidate(self.slots[other], 'CONTROLLER_CHANGED', 'volante trocado')
            self.pad_map[other] = self.pad_map[number - 1]
        if self.pad_map[number - 1] != index: self.invalidate(slot, 'CONTROLLER_CHANGED', 'volante trocado')
        self.pad_map[number - 1] = index
        self.save('pad_map', ','.join(map(str, self.pad_map)))
        slot.consumed_start = True  # the A+B that synced must not also start or finish a race
        self.pairing = None
        self.last_paired = number
        self.note(f'Vaga {number:02d} {slot.name}: volante sincronizado.')
        self.log(slot, 'info', 'Volante', f'Volante sincronizado (canal {index + 1}).')

    # ---------- setup wizard: + ADICIONAR CONTROLE ----------
    def capacity(self):
        """Slots that can be configured: the cockpits, but no more than there are wheel channels."""
        return min(len(self.slots), self.wheels)

    def colors_in_use(self):
        return {s.color for s in self.slots[:self.available]}

    def setup_start(self, color, now):
        """Starts configuring the next free slot with this color: sync the wheel (A+B),
        confirm wheel and pedals, check the board talks, then the slot is ready."""
        number = self.available + 1
        if self.setup or number > self.capacity(): return False
        if type(color) is not int or not 1 <= color <= len(CAR_NAMES) or color in self.colors_in_use(): return False
        slot = self.slot(number)
        slot.color = color; self.save(f'slot{number}_color', color)
        self.setup = dict(slot=number, step='sync', seen=dict(left=False, right=False, throttle=False, brake=False))
        self.last_paired = None
        self.pair(number, now)
        return True

    def setup_cancel(self):
        if not self.setup: return
        if self.pairing and self.pairing[0] == self.setup['slot']: self.pairing = None
        self.setup = None

    def follow_setup(self, now):
        setup = self.setup
        if not setup: return
        number = setup['slot']; slot = self.slot(number)
        if setup['step'] == 'sync':
            if self.last_paired == number: setup['step'] = 'confirm'
            elif not self.pairing: self.pair(number, now)  # keeps waiting for A+B until cancelled
        if setup['step'] == 'confirm':
            pad = self.pads[self.pad_map[number - 1]]
            if pad:
                seen = setup['seen']
                seen['left'] |= pad['steering'] <= -CONFIRM_STEERING
                seen['right'] |= pad['steering'] >= CONFIRM_STEERING
                seen['throttle'] |= pad['throttle'] >= CONFIRM_PEDAL
                seen['brake'] |= pad['brake'] >= CONFIRM_PEDAL
                if all(seen.values()): setup['step'] = 'comms'
        if setup['step'] == 'comms':
            board = self.board_of(slot)
            if board and board.alive(now):
                self.available = number; self.save('available_slots', number)
                self.setup = None
                self.note(f'Vaga {number:02d} {slot.name}: controle configurado.')

    def setup_summary(self, now):
        if not self.setup: return None
        number = self.setup['slot']; slot = self.slot(number)
        pad = self.pads[self.pad_map[number - 1]]
        board = self.board_of(slot)
        return dict(slot=number, color=slot.color, step=self.setup['step'], seen=dict(self.setup['seen']),
                    input=({k: pad[k] for k in ('steering', 'throttle', 'brake')} if pad and self.setup['step'] != 'sync' else None),
                    board=bool(board and board.alive(now)), pairing=bool(self.pairing and self.pairing[0] == number))

    # ---------- the control loop ----------
    def step(self, now, panel_inputs=None):
        """One tick: read boards, place new ones, run the 4 races, write relays."""
        for board in list(self.boards.values()):
            try:
                was = board.hello
                board.read(now)
                if board.hello and not was: self.place(board)
            except (serial.SerialException, OSError) as error:
                self.drop(board, str(error), now)
        self.follow_pairing(now)
        self.follow_setup(now)
        for slot in self.slots:
            board = self.board_of(slot)
            slot.controller.connected = bool(board and board.alive(now))
            self.follow_link(slot, board, now)
            self.follow_acceptance(slot, board, now)
            slot.controller.set_blocked(self.block_reason(slot))
            slot.controller.tick(now, self.pad_input(slot))
            self.follow_battery(slot, now)
        for board in self.boards.values():
            if board.slot: continue
            board.spare.connected = board.alive(now)
            board.spare.tick(now, None)
        for board in list(self.boards.values()):
            self.follow_test(board, now)
            try:
                board.write(now)
            except (serial.SerialException, OSError) as error:
                self.drop(board, str(error), now)

    def block(self, slot):
        """Why this car cannot start now, most important first: (code, message), or (None, None).
        The code tells the screens which check to point at (grid card, Central Técnica)."""
        if slot.number > self.available: return 'unconfigured', UNCONFIGURED
        if slot.emergency: return 'emergency', EMERGENCY_BLOCK
        if slot.acceptance.running: return 'acceptance_running', ACCEPTANCE_RUNNING
        if self.battery_state(slot)['alert'] == 'stop': return 'battery', BATTERY_BLOCK
        if self.acceptance_required and not slot.acceptance.released(): return 'acceptance', ACCEPTANCE_BLOCK
        return None, None

    def block_reason(self, slot):
        return self.block(slot)[1]

    # ---------- Central Técnica: link, acceptance, emergency ----------
    def follow_link(self, slot, board, now):
        if board and board.restarted:
            board.restarted = False
            self.log(slot, 'warning', 'Placa', 'A placa reiniciou.')
            self.invalidate(slot, 'ESP32_RESTARTED', 'a placa reiniciou')
        if board and board.late > slot.late_seen:
            slot.late_seen = board.late
            self.log(slot, 'warning', 'Placa', f'Confirmação atrasada (mais de {round(LATE_ACK * 1000)} ms).')
        if board and board.alive(now):
            slot.offline_since = None
            return
        if slot.offline_since is None: slot.offline_since = now
        elif now - slot.offline_since >= COMM_LOSS and not slot.acceptance.running:
            self.invalidate(slot, 'COMMUNICATION_RESET', 'placa sem comunicação por muito tempo')

    def follow_acceptance(self, slot, board, now):
        acc, c = slot.acceptance, slot.controller
        if acc.running:
            alive = bool(board and board.alive(now))
            acc.step(now, dict(alive=alive, port=board.port if board else None, firmware=board.firmware if board else None,
                               confirmMs=board.confirm_ms if board else None, ackGap=board.max_gap(now) if alive else None,
                               confirmed=board.confirmed if alive else None, pad=self.pads[self.pad_map[slot.number - 1]],
                               testing=c.phase == 'test', simulatedCamera=self.simulated_camera))
        relays = acc.current in ('actuators', 'emergency') and acc.stage == 'run'
        if relays and c.phase != 'test': c.start_test(now, 'Aceite técnico: teste dos relés.')
        if c.phase == 'test':
            # Relays follow the check; once it ends (or is cancelled / invalidated) they go off.
            if relays: c.test_mask = acc.mask
            else: c.end_test('Teste concluído. Relés desligados.')
        if acc.want_stop: c.stop('Teste da parada de emergência.')
        self.log_acceptance(slot)

    def log_acceptance(self, slot):
        """Each check that passed or failed, and the end of a full run, go to the car's log once."""
        acc = slot.acceptance
        for name, item in acc.items.items():
            if slot.acc_seen.get(name) != item['status'] and item['status'] in ('passed', 'failed'):
                self.log(slot, 'success' if item['status'] == 'passed' else 'error', 'Aceite',
                         f'{LABELS[name]}: {"APROVADO" if item["status"] == "passed" else "FALHA"} · {item["message"]}')
            slot.acc_seen[name] = item['status']
        if acc.last_run is not slot.acc_run_seen:
            slot.acc_run_seen = acc.last_run
            passed = acc.last_run['result'] == 'passed'
            self.log(slot, 'success' if passed else 'error', 'Aceite',
                     'Aceite concluído: UNIDADE APTA.' if passed else 'Aceite concluído: UNIDADE BLOQUEADA.')

    def acceptance_start(self, number, items, now):
        """Full acceptance (items None) or some checks, with the car stopped."""
        slot = self.slot(number)
        if not slot or slot.number > self.available or slot.emergency: return False
        if slot.controller.phase in ('starting', 'countdown', 'running', 'test'): return False
        if not slot.acceptance.start(items, now): return False
        self.log(slot, 'info', 'Aceite', 'Aceite técnico iniciado.' if items is None else
                 'Teste: ' + ', '.join(LABELS[i] for i in slot.acceptance.queue) + '.')
        return True

    def acceptance_area(self, number, now):
        slot = self.slot(number)
        if slot and slot.acceptance.confirm_area(now):
            self.log(slot, 'warning', 'Aceite', 'Área livre confirmada pelo operador.')

    def acceptance_report(self, number, item, data, now):
        slot = self.slot(number)
        return bool(slot) and slot.acceptance.report(item, data, now)

    def acceptance_cancel(self, number):
        slot = self.slot(number)
        if not slot or not slot.acceptance.running: return
        slot.acceptance.cancel('Cancelado pelo operador.')
        slot.controller.end_test('Aceite cancelado. Relés desligados.')
        self.log(slot, 'warning', 'Aceite', 'Aceite cancelado pelo operador.')

    def invalidate_all(self, trigger, why):
        for slot in self.slots[:self.available]: self.invalidate(slot, trigger, why)

    def emergency(self, number):
        """PARADA DE EMERGÊNCIA of one car: relays off now, nothing starts until RESET,
        and the acceptance must be done again."""
        slot = self.slot(number)
        if not slot: return False
        slot.emergency = True
        slot.controller.stop('PARADA DE EMERGÊNCIA acionada pelo técnico.')
        self.log(slot, 'error', 'Emergência', 'PARADA DE EMERGÊNCIA acionada: relés desligados.')
        self.invalidate(slot, 'TECHNICAL_INTERVENTION', 'parada de emergência')
        self.note(f'Vaga {number:02d} {slot.name}: PARADA DE EMERGÊNCIA.')
        return True

    def emergency_reset(self, number):
        slot = self.slot(number)
        if not slot or not slot.emergency: return False
        slot.emergency = False
        self.log(slot, 'warning', 'Emergência', 'RESET da parada de emergência. Refaça o aceite antes de liberar.')
        return True

    def unit_state(self, slot, board, now):
        """One state per car, computed here (screens never make up their own)."""
        acc = slot.acceptance
        if slot.emergency: return 'EMERGENCY_STOP'
        if not board: return 'OFFLINE'
        if not board.alive(now): return 'CONNECTING'
        if acc.running or slot.controller.phase in ('selftest', 'pulse', 'test'): return 'TESTING'
        if any(acc.items[k]['status'] == 'failed' for k in CRITICAL): return 'FAULT'
        if self.battery_state(slot)['alert'] != 'ok' or (self.acceptance_required and not acc.released()): return 'WARNING'
        return 'READY'

    def start_all(self, now):
        """Operator start: 3-2-1 for every car that is ready (a new race: a new finishing order)."""
        started = [s.number for s in self.slots if s.controller.start_countdown(now)]
        if started: self.finish_order = []
        return started

    def finished(self, slot, duration_ms):
        """A car completed the time trial: it takes the next place (the first one is the champion)."""
        if any(r['slot'] == slot.number for r in self.finish_order): return
        self.finish_order.append(dict(slot=slot.number, color=slot.color, durationMs=duration_ms,
                                      position=len(self.finish_order) + 1))

    def stop_all(self, reason='Parada geral pelo operador.'):
        for slot in self.slots: slot.controller.stop(reason)
        for board in self.boards.values():
            if not board.slot: board.spare.stop(reason)

    def set_mode(self, laps):
        for slot in self.slots:
            slot.controller.message(dict(type='mode', data=dict(laps=laps)), slot.controller.now)

    def set_auto_test(self, enabled):
        self.auto_test = bool(enabled); self.save('auto_test', '1' if enabled else '0')

    def set_driver(self, number, name, clean):
        slot = self.slot(number)
        if slot: slot.driver = clean(name); self.save(f'slot{number}_driver', slot.driver)

    def shutdown(self):
        for board in list(self.boards.values()): board.close()
        self.boards.clear()

    # ---------- what the screens see ----------
    def raw_input(self, slot):
        """Raw axes of the wheel (XInput: steering -32768..32767, pedals 0..255), when the reading has them."""
        pad = self.pads[self.pad_map[slot.number - 1]]
        if not pad or 'rawSteering' not in pad: return None
        return dict(steering=pad['rawSteering'], throttle=pad['rawThrottle'], brake=pad['rawBrake'])

    def classification(self, now):
        """Live order of the cars racing: more laps first, then who closed the last lap earlier."""
        rows = []
        for slot in self.slots:
            c = slot.controller
            if c.phase != 'running': continue
            times = c.race_times(now)
            rows.append(dict(slot=slot.number, name=slot.name, driver=slot.driver, **times))
        rows.sort(key=lambda r: (-r['laps'], r['lastMarkMs'] if r['laps'] else 0, r['slot']))
        for position, row in enumerate(rows, 1): row['position'] = position
        return rows

    def summary(self, now):
        slots = []
        for slot in self.slots:
            c, board = slot.controller, self.board_of(slot)
            pad_index = self.pad_map[slot.number - 1]
            slots.append(dict(
                number=slot.number, name=slot.name, color=slot.color, driver=slot.driver,
                boardId=slot.board_id, port=board.port if board else None, firmware=board.firmware if board else None,
                connected=bool(board and board.alive(now)), wheel=pad_index + 1, wheelConnected=self.pads[pad_index] is not None,
                phase=c.phase, countdown=c.countdown(), enabled=c.enabled, mask=c.mask,
                relayMask=board.confirmed if board and board.alive(now) else None, input=c.input,
                lapCount=len(c.laps) if c.phase == 'running' else 0, raceMode=c.target_laps,
                selfTest=dict(board.test) if board else None, status=c.reason, lastResult=slot.last_result,
                blocked=bool(c.blocked),
                lastLap=(dict({k: v for k, v in slot.last_lap.items() if k != 'when'},
                              ageMs=round((now - slot.last_lap['when']) * 1000)) if slot.last_lap else None),
                times=c.race_times(now),
                battery=self.battery_state(slot),
                state=self.unit_state(slot, board, now), emergency=slot.emergency, blockReason=self.block(slot)[0],
                unitId=f'RC-{slot.number:02d}',
                acceptance=slot.acceptance.summary(self.acceptance_required),
                link=dict(port=board.port if board else None, firmware=board.firmware if board else None,
                          boardId=board.board_id if board else slot.board_id,
                          confirmMs=board.confirm_ms if board else None,
                          rateHz=board.rate(now) if board else 0, late=board.late if board else 0,
                          restarts=board.restarts if board else 0, reconnects=slot.reconnects,
                          lastAckMs=(round((now - board.last_ack) * 1000) if board and board.confirmed is not None else None),
                          uptimeMs=round((now - board.opened) * 1000) if board else None),
                raw=self.raw_input(slot),
                deadzone=dict(steering=STEER_ON, pedals=PEDAL_ON),
                log=list(slot.log)[:LOG_SHOWN]))
        spare = [dict(port=b.port, boardId=b.board_id, firmware=b.firmware, connected=b.alive(now),
                      selfTest=dict(b.test)) for b in self.boards.values() if not b.slot and b.hello]
        return dict(slots=slots, spareBoards=spare, classification=self.classification(now),
                    pairing=self.pairing[0] if self.pairing else None, autoTest=self.auto_test, available=self.available,
                    cockpits=len(self.slots), capacity=self.capacity(), wheels=self.wheels,
                    setup=self.setup_summary(now), colors=len(CAR_NAMES), finishOrder=list(self.finish_order),
                    events=[e['text'] for e in self.events])
