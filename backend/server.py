"""RC Racing server: N cars at once (see fleet.py), wheels via XInput, and the
screens over WebSocket: one per color slot (cockpit tablets, ?vaga=N) plus the
operator panel (?painel=1, only from this PC).

Two arenas, never mixed: the real one (only boards and wheels plugged into this
PC, database rc-racing.db) and the SIMULAÇÃO one (virtual boards and drivers,
database rc-racing-simulado.db), reached with ?simulacao=1. The screens are the
same in both.

Listens on the local network so the cockpit tablets can connect; only
loopback and private-network clients are accepted.
"""
import argparse
import asyncio
import contextlib
import ctypes
import ipaddress
import json
import logging
import os
import socket
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

import serial
from serial.tools import list_ports
from aiohttp import web, WSMsgType
from backend import diagnose
from backend.fleet import Fleet
from backend.history import History, clean_driver

# The panel's build: frontend/dist in the repository; the packaged app (PyInstaller)
# unpacks it as dist/ next to the executable.
ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
PANEL = ROOT / 'dist' if hasattr(sys, '_MEIPASS') else ROOT / 'frontend' / 'dist'
DATA = Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'RC Racing'
DB_FILE = DATA / 'rc-racing.db'
SIM_DB_FILE = DATA / 'rc-racing-simulado.db'
SIM_COCKPITS = 16  # the simulation fills every grid
SIM_RACE_LAPS = 5
SIM_NEXT_RACE = 8.0  # seconds the champion stays on screen before the next simulated race
# Minutes used of each virtual battery when the simulation starts: most charged,
# a few low / critical / empty, so the warnings can be seen and tested.
SIM_BATTERY_MINUTES = (2, 6, 4, 9, 3, 12, 5, 8, 25, 27.5, 29, 7, 1, 10, 4, 6)
# USB-serial chips used by ESP32 boards: CP210x, CH340/CH9102, FTDI, Espressif native USB.
ESP32_VIDS = {0x10C4, 0x1A86, 0x0403, 0x303A}
# XInput buttons: A starts, B finishes, X is the emergency stop, Y marks a lap.
START_BUTTON = 0x1000
FINISH_BUTTON = 0x2000
PANIC_BUTTON = 0x4000
LAP_BUTTON = 0x8000
SCAN_EVERY = 1.0
HINT_INTERVAL = 10
LOG = logging.getLogger('cockpit')


def find_ports():
    """Candidate ESP32 ports, most likely first; Bluetooth serial ports are skipped."""
    ports = [p for p in list_ports.comports() if p.vid is not None and 'BTHENUM' not in (p.hwid or '').upper()]
    ports.sort(key=lambda p: p.vid not in ESP32_VIDS)
    return [p.device for p in ports]


def local_address(host):
    """Loopback or private network (the event router), never the internet."""
    if host in ('localhost', socket.gethostname().lower(), f'{socket.gethostname().lower()}.local'): return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.is_loopback or address.is_private


def lan_addresses():
    """IPv4 addresses of this PC on the local network (for the tablet links)."""
    found = set()
    with contextlib.suppress(OSError):
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(info[4][0])
    with contextlib.suppress(OSError), socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect(('10.255.255.255', 1))  # no packet is sent; picks the LAN interface
        found.add(probe.getsockname()[0])
    return sorted(a for a in found if ipaddress.ip_address(a).is_private and not a.startswith('127.'))


class Pad(ctypes.Structure):
    _fields_ = [('buttons', ctypes.c_ushort), ('lt', ctypes.c_ubyte), ('rt', ctypes.c_ubyte),
                ('lx', ctypes.c_short), ('ly', ctypes.c_short), ('rx', ctypes.c_short), ('ry', ctypes.c_short)]


class PadState(ctypes.Structure):
    _fields_ = [('packet', ctypes.c_uint32), ('pad', Pad)]


def pad_reading(p):
    return dict(steering=max(-100, min(100, p.lx / 32767 * 100)),
                throttle=100 if p.buttons & 512 else p.rt / 255 * 100,
                brake=100 if p.buttons & 256 else p.lt / 255 * 100,
                start=bool(p.buttons & START_BUTTON), finish=bool(p.buttons & FINISH_BUTTON),
                panic=bool(p.buttons & PANIC_BUTTON), lap=bool(p.buttons & LAP_BUTTON),
                rawSteering=p.lx, rawThrottle=p.rt, rawBrake=p.lt)


class Server:
    def __init__(self, serial_factory=serial.Serial, history=None, ports=find_ports, xinput=True, autopilot=None,
                 cockpits=None, wheels=None):
        self.history = history or History()
        self.fleet = Fleet(serial_factory=serial_factory, ports=ports, settings=self.history, cockpits=cockpits,
                           **({'wheels': wheels} if wheels else {}))
        # Test server only: no camera to measure, the camera check passes as "simulada".
        self.fleet.simulated_camera = autopilot is not None
        self.sim_done_at = None  # SIMULAÇÃO: when the last race ended (the next one starts by itself)
        self.fleet.acceptance_required = bool(self.history.current_event())
        # Event record (fastest lap saved) and the alerts the operator panel shows once each.
        self.event = self.history.current_event()
        self.event_best = self.history.best_lap()
        self.alerts = []
        self.alert_seq = 0
        self.ranking_view = self.history.event_ranking()
        self.clients = {}  # ws -> dict(slot=int|None, operator=bool)
        self.owners = {}  # slot number -> ws allowed to drive it from the screen
        self.last_scan = -SCAN_EVERY
        self.scanning = None
        self.board_hint = 'ESP32 não encontrado. Conecte o cabo USB da placa.'
        self.wheel_hint = None
        self.hint_task = None
        self.hint_at = -HINT_INTERVAL
        self.autopilot = autopilot  # simulated drivers for missing wheels (test mode only)
        self.xinput = None
        if xinput:
            try:
                self.xinput = ctypes.WinDLL('xinput1_4.dll')
                self.xinput.XInputGetState.argtypes = [ctypes.c_uint32, ctypes.POINTER(PadState)]
                self.xinput.XInputGetState.restype = ctypes.c_uint32
            except (AttributeError, OSError): self.xinput = None

    # ---------- hardware ----------
    def read_pads(self):
        """The XInput wheels (at most 4); each one drives the slot it is paired with.
        In the SIMULAÇÃO arena (no XInput) every channel starts each tick empty, so the
        virtual drivers fill them again with fresh readings."""
        if not self.xinput:
            if self.autopilot: self.fleet.pads = [None] * self.fleet.pad_count
            return
        pads = []
        for index in range(min(self.fleet.wheels, 4)):
            state = PadState()
            pads.append(pad_reading(state.pad) if self.xinput.XInputGetState(index, ctypes.byref(state)) == 0 else None)
        self.fleet.pads = pads + [None] * (self.fleet.pad_count - len(pads))

    async def hardware_loop(self):
        try:
            while True:
                now = time.monotonic()
                self.read_pads()
                if self.autopilot: self.fleet.pads = self.autopilot.fill(self.fleet.pads, now, self.fleet)
                if now - self.last_scan >= SCAN_EVERY and (not self.scanning or self.scanning.done()):
                    self.last_scan = now
                    # Listing and opening COM ports can block: off the control loop.
                    self.scanning = asyncio.create_task(asyncio.to_thread(self.fleet.scan, now))
                # An open event requires the technical acceptance before a car starts.
                self.fleet.acceptance_required = bool(self.event)
                self.fleet.step(time.monotonic())
                for slot in self.fleet.slots:
                    await self.save_acceptances(slot)
                    await self.follow_laps(slot)
                    if slot.controller.finished_race: await self.save_race(slot)
                    await self.close_short_race(slot)
                self.refresh_hints(now)
                self.next_simulated_race(time.monotonic())
                await asyncio.sleep(.02)
        finally:
            self.fleet.stop_all('Serviço encerrado.')
            self.fleet.shutdown()

    def next_simulated_race(self, now):
        """SIMULAÇÃO only: the champion is shown for a while, then the batteries are refilled and a
        new race starts by itself, so the screens never sit still. The real cars wait for the operator."""
        if not self.autopilot: return
        fleet = self.fleet
        busy = any(s.controller.phase in ('starting', 'countdown', 'running') for s in fleet.slots)
        if busy or not fleet.finish_order:
            self.sim_done_at = None
            return
        if self.sim_done_at is None: self.sim_done_at = now
        if now - self.sim_done_at < SIM_NEXT_RACE: return
        for slot in fleet.slots[:fleet.available]: fleet.battery(slot.number, 'new', now)
        fleet.start_all(now)
        self.sim_done_at = None

    def refresh_hints(self, now):
        """Explains a missing board or wheel; the Windows queries run off the control loop."""
        if self.autopilot: return  # simulation: nothing to diagnose on this PC
        need_board = not any(s.controller.connected for s in self.fleet.slots)
        need_wheel = all(p is None for p in self.fleet.pads)
        if not (need_board or need_wheel) or (self.hint_task and not self.hint_task.done()) or now - self.hint_at < HINT_INTERVAL:
            if not need_wheel: self.wheel_hint = None
            return
        self.hint_at = now

        async def check():
            if need_board: self.board_hint = await asyncio.to_thread(diagnose.board_hint)
            if need_wheel: self.wheel_hint = await asyncio.to_thread(diagnose.wheel_hint, False)
        self.hint_task = asyncio.create_task(check())

    async def save_acceptances(self, slot):
        """Each full technical acceptance that ended goes to the database (car, board, event, result)."""
        while slot.acceptance.finished:
            run = slot.acceptance.finished.pop(0)
            try:
                await asyncio.to_thread(self.history.record_acceptance, slot.number, slot.color, slot.board_id,
                                        run['result'], run['trigger'], run['items'])
            except Exception:
                LOG.exception('Não foi possível salvar o aceite técnico')

    async def follow_laps(self, slot):
        """Saves each lap the moment it closes (no one types anything) and raises the alerts."""
        c = slot.controller
        if slot.race_key != c.race_id:
            if c.phase != 'running' or not c.laps: return  # the race row is created with its first lap
            slot.race_key, slot.race_row, slot.saved_laps = c.race_id, None, 0
        if slot.saved_laps >= len(c.laps): return
        try:
            if slot.race_row is None:
                slot.race_row = await asyncio.to_thread(self.history.start_race, slot.number, slot.color, c.target_laps)
            marks = [c.race_start] + c.laps
            while slot.saved_laps < len(c.laps):
                i = slot.saved_laps
                lap_ms = round((marks[i + 1] - marks[i]) * 1000)
                before = [round((b - a) * 1000) for a, b in zip(marks[:i], marks[1:i + 1])]
                ranking_before = self.ranking_view
                await asyncio.to_thread(self.history.add_lap, slot.race_row, i + 1, lap_ms)
                slot.saved_laps += 1
                if self.event: self.ranking_view = await asyncio.to_thread(self.history.event_ranking)
                self.lap_alerts(slot, i + 1, lap_ms, min(before) if before else None)
                if self.event: self.ranking_alerts(slot, ranking_before, self.ranking_view)
        except Exception:
            LOG.exception('Não foi possível salvar a volta no histórico')

    def lap_alerts(self, slot, number, lap_ms, personal_best):
        """Personal best (beats this race's best) and event record (beats every lap saved)."""
        # Practice (no event open) never makes a record.
        record = bool(self.event) and (self.event_best is None or lap_ms < self.event_best['lapMs'])
        at = datetime.now().astimezone().isoformat(timespec='seconds')
        slot.last_lap = dict(number=number, lapMs=lap_ms, record=record,
                             personalBest=personal_best is not None and lap_ms < personal_best, when=time.monotonic())
        if not record: return
        self.event_best = dict(lapMs=lap_ms, at=at, slot=slot.number, color=slot.color, raceId=slot.race_row,
                               code=self.session_code(slot))
        self.alert('record', slot, lapMs=lap_ms)
        seconds = lap_ms / 1000
        self.fleet.note(f'Vaga {slot.number:02d} {slot.name}: novo recorde do evento '
                        f'({int(seconds // 60):02d}:{seconds % 60:06.3f}).')

    def alert(self, kind, slot, **extra):
        """One alert for the operator panel (each id is shown once)."""
        self.alert_seq += 1
        item = dict(id=self.alert_seq, kind=kind, slot=slot.number if slot else 0, color=slot.color if slot else 0,
                    at=datetime.now().astimezone().isoformat(timespec='seconds'), **extra)
        self.alerts = ([item] + self.alerts)[:8]

    def session_code(self, slot):
        row = next((r for r in self.ranking_view['rows'] if r['raceId'] == slot.race_row), None)
        return row['code'] if row else None

    def ranking_alerts(self, slot, before, after):
        """ENTROU NO TOP N, SAIU DO TOP N (who was pushed out) and NOVO TEMPO DE CORTE."""
        top = after['topN']
        was = {r['raceId']: r for r in before['rows']}
        now = {r['raceId']: r for r in after['rows']}
        mine = now.get(slot.race_row)
        if mine and mine['inTop'] and not was.get(slot.race_row, {}).get('inTop'):
            self.alert('top', slot, position=mine['position'], code=mine['code'], lapMs=mine['bestLapMs'], topN=top)
        for race_id, old in was.items():
            if old['inTop'] and race_id in now and not now[race_id]['inTop']:
                self.alert('out', None, slotOut=old['slot'], colorOut=old['color'], code=old['code'],
                           position=now[race_id]['position'], topN=top)
        if after['cutMs'] is not None and after['cutMs'] != before['cutMs']:
            self.alert('cut', None, lapMs=after['cutMs'], topN=top)

    def open_event(self, name):
        if not self.history.open_event(name): return
        self.event = self.history.current_event()
        self.event_best, self.ranking_view = None, self.history.event_ranking()
        self.fleet.note(f'Evento aberto: {self.event["name"]}. Voltas a partir de agora contam para o ranking.')
        # A new event needs a new acceptance of every car before it can start.
        self.fleet.invalidate_all('EVENT_START', 'evento aberto')
        self.fleet.acceptance_required = True

    def close_event(self):
        if not self.history.close_event(): return
        name = self.event['name'] if self.event else ''
        self.event, self.event_best, self.ranking_view = None, None, self.history.event_ranking(0)
        self.fleet.note(f'Evento encerrado: {name}. Voltas seguintes são treino.')

    async def close_short_race(self, slot):
        c = slot.controller
        if slot.race_row is None or slot.race_key != c.race_id or c.phase == 'running' or c.finished_race: return
        row, slot.race_row = slot.race_row, None
        try: await asyncio.to_thread(self.history.close_race, row, c.reason)
        except Exception: LOG.exception('Não foi possível fechar a corrida no histórico')

    def fleet_summary(self, now):
        """The fleet plus the event record and the latest alerts (for the operator panel)."""
        summary = self.fleet.summary(now)
        view = self.ranking_view
        top = view['topN']
        summary.update(record=self.event_best, alerts=list(self.alerts), event=self.event,
                       ranking=dict(topN=top, total=view['total'], cutMs=view['cutMs'], rows=view['rows'][:top + 3]))
        by_race = {r['raceId']: r for r in view['rows']}
        for slot, data in zip(self.fleet.slots, summary['slots']):
            mine = by_race.get(slot.race_row) if slot.race_key == slot.controller.race_id else None
            data['session'] = (dict(code=mine['code'], position=mine['position'], bestLapMs=mine['bestLapMs'],
                                    inTop=mine['inTop'], total=view['total']) if mine else None)
        return summary

    async def save_race(self, slot):
        """Stores the race that just ended in this color and publishes the result."""
        race, slot.controller.finished_race = slot.controller.finished_race, None
        if race.get('completed'): self.fleet.finished(slot, race['duration_ms'])
        best = min(race['laps_ms']) if race['laps_ms'] else None
        row, slot.race_row = (slot.race_row if slot.race_key == slot.controller.race_id else None), None
        try:
            race_id = (await asyncio.to_thread(self.history.finish_race, row, race) if row is not None else
                       await asyncio.to_thread(self.history.record, race, slot.driver, None, slot.number, slot.color))
            position = await asyncio.to_thread(self.history.lap_position, best) if best else None
            target, completed = race.get('target_laps', 0), bool(race.get('completed'))
            trial = (await asyncio.to_thread(self.history.trial_position, target, race['duration_ms'])
                     if completed else None)
        except Exception:
            LOG.exception('Não foi possível salvar a corrida no histórico')
            return
        slot.last_result = dict(raceId=race_id, driver=slot.driver, durationMs=race['duration_ms'],
                                laps=len(race['laps_ms']), bestLapMs=best, position=position, reason=race['reason'],
                                targetLaps=target, completed=completed, trialPosition=trial, slot=slot.number,
                                color=slot.color)

    # ---------- what each screen receives ----------
    def telemetry(self, number=1, ws=None, summary=None):
        """One color slot, in the shape the cockpit screens use, plus the whole fleet."""
        fleet, now = self.fleet, time.monotonic()
        slot = fleet.slot(number) or fleet.slots[0]
        c, board = slot.controller, fleet.board_of(slot)
        pad = fleet.pads[fleet.pad_map[slot.number - 1]]
        test = board.test if board else dict(running=False, results=[None] * 4, interrupted=False)
        status = (c.reason if board else f'Sem carrinho na vaga {slot.number:02d} {slot.name}. {self.board_hint}')
        if not pad and c.phase in ('idle', 'finished') and self.wheel_hint: status = self.wheel_hint
        return dict(connected=c.connected, carEnabled=c.enabled, **c.input,
                    speed=None, battery=None, signal=None, temperature=None, position=None,
                    relayMask=board.confirmed if board and c.connected else None, requestedMask=c.mask,
                    port=board.port if board else '—',
                    controlAvailable=ws is not None and (self.owners.get(slot.number) is ws or self.clients.get(ws, {}).get('operator', False)),
                    usbConnected=pad is not None,
                    usbInput={k: pad[k] for k in ('steering', 'throttle', 'brake')} if pad else dict(steering=0, throttle=0, brake=0),
                    phase=c.phase, countdown=c.countdown(), raceId=c.race_id,
                    driver=slot.driver, lapCount=len(c.laps) if c.phase == 'running' else 0, lastResult=slot.last_result,
                    raceMode=c.target_laps, selfTest=dict(test, auto=fleet.auto_test), status=status,
                    slot=dict(number=slot.number, name=slot.name, color=slot.color), times=c.race_times(now),
                    fleet=summary or self.fleet_summary(now))

    # ---------- commands ----------
    def operator_command(self, kind, data):
        fleet, now = self.fleet, time.monotonic()
        number = data.get('slot')
        if kind == 'startAll': fleet.start_all(now)
        elif kind == 'stopAll': fleet.stop_all()
        elif kind == 'assign': fleet.assign(data.get('port'), number)
        elif kind == 'release': fleet.release(number)
        elif kind == 'pairWheel': fleet.pair(number, now)
        elif kind == 'mode' and type(data.get('laps')) is int: fleet.set_mode(data['laps'])
        elif kind == 'autoTest': fleet.set_auto_test(data.get('enabled') is True)
        elif kind == 'battery': fleet.battery(number, data.get('action'), now)
        elif kind == 'setupStart': fleet.setup_start(data.get('color'), now)
        elif kind == 'setupCancel': fleet.setup_cancel()
        elif kind == 'eventOpen': self.open_event(data.get('name'))
        elif kind == 'eventClose': self.close_event()
        elif kind == 'acceptanceStart':
            items = data.get('items')
            fleet.acceptance_start(number, items if isinstance(items, list) else None, now)
        elif kind == 'acceptanceArea': fleet.acceptance_area(number, now)
        elif kind == 'acceptanceReport': fleet.acceptance_report(number, data.get('item'), data, now)
        elif kind == 'acceptanceCancel': fleet.acceptance_cancel(number)
        elif kind == 'emergency': fleet.emergency(number)
        elif kind == 'emergencyReset': fleet.emergency_reset(number)
        elif kind == 'testBoard':
            board = fleet.boards.get(data.get('port'))
            if board: fleet.self_test(board, now)
        else: return False
        return True

    def slot_command(self, number, payload, ws, operator):
        """Commands for one color: stop from anyone; the rest from its owner or the operator."""
        fleet, now = self.fleet, time.monotonic()
        slot = fleet.slot(number)
        if not slot: return
        kind, data = payload.get('type'), payload.get('data')
        is_stop = kind == 'stop' or (kind == 'enable' and isinstance(data, dict) and data.get('carEnabled') is False)
        if kind == 'claim' and data == {}:
            slot.controller.stop('Controle assumido nesta tela.'); self.owners[number] = ws; return
        if not (is_stop or operator or self.owners.get(number) is ws): return
        if kind == 'selftest':
            board = fleet.board_of(slot)
            if board: fleet.self_test(board, now)
        elif kind == 'autoTest' and isinstance(data, dict): fleet.set_auto_test(data.get('enabled') is True)
        elif kind == 'driver' and isinstance(data, dict): fleet.set_driver(number, data.get('name'), clean_driver)
        elif kind == 'start': slot.controller.start_countdown(now)
        else: slot.controller.message(payload, now)

    async def websocket(self, request):
        origin = urlsplit(request.headers.get('Origin', ''))
        if not origin.hostname or not local_address(origin.hostname) or not local_address(request.remote or ''):
            raise web.HTTPForbidden(text='Origem não autorizada.')
        loopback = ipaddress.ip_address(request.remote).is_loopback if request.remote else False
        operator = request.query.get('painel') == '1' and loopback  # race control only from this PC
        try: number = int(request.query.get('vaga', '1'))
        except ValueError: number = 1
        if not self.fleet.slot(number): number = 1
        ws = web.WebSocketResponse(max_msg_size=4096, heartbeat=2)
        await ws.prepare(request)
        self.clients[ws] = dict(slot=number, operator=operator)
        if not operator and number not in self.owners: self.owners[number] = ws

        async def publish():
            while not ws.closed:
                await ws.send_json(dict(type='telemetry', data=self.telemetry(number, ws)))
                await asyncio.sleep(.05)
        task = asyncio.create_task(publish())
        try:
            async for message in ws:
                if message.type != WSMsgType.TEXT: continue
                try: payload = json.loads(message.data)
                except (ValueError, TypeError): payload = None
                if not isinstance(payload, dict):
                    if self.owners.get(number) is ws: self.fleet.slot(number).controller.stop('Mensagem inválida.')
                    continue
                data = payload.get('data') if isinstance(payload.get('data'), dict) else {}
                if operator and self.operator_command(payload.get('type'), data): continue
                target = data.get('slot') if operator and isinstance(data.get('slot'), int) else number
                self.slot_command(target, payload, ws, operator)
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception): await task
            self.clients.pop(ws, None)
            if self.owners.get(number) is ws:
                # Racing is driven by the wheels, so closing a screen does not stop the car.
                self.fleet.slot(number).controller.panel_input = None
                others = [w for w, info in self.clients.items() if info['slot'] == number and not info['operator']]
                if others: self.owners[number] = others[0]
                else: self.owners.pop(number, None)
        return ws


def seed_simulation(history, cockpits=SIM_COCKPITS):
    """The simulation starts ready for testing and validation every time: every cockpit
    configured with its color, board and wheel, batteries mostly charged (a few warnings).
    Its events, laps and acceptances stay in its own database."""
    history.set_setting('cockpits', cockpits)
    history.set_setting('available_slots', cockpits)
    history.set_setting('pad_map', ','.join(str(i) for i in range(cockpits)))
    for n in range(1, cockpits + 1):
        history.set_setting(f'slot{n}_color', n)
        history.set_setting(f'slot{n}_board', f'SIMULADO{n:02d}')
        history.set_setting(f'slot{n}_battery_used', SIM_BATTERY_MINUTES[(n - 1) % len(SIM_BATTERY_MINUTES)] * 60)
        history.set_setting(f'slot{n}_battery_on', '1')


def simulation_server(db=SIM_DB_FILE, cockpits=SIM_COCKPITS):
    """The SIMULAÇÃO arena: virtual boards (SIM1..), virtual drivers, its own database."""
    from backend.simulated import AutoPilot, with_simulated
    history = History(db)
    seed_simulation(history, cockpits)
    ports, factory = with_simulated(cockpits, lambda: [])
    # Virtual wheels are not limited by XInput: one per cockpit.
    server = Server(history=history, serial_factory=factory, ports=ports, xinput=False, autopilot=AutoPilot(),
                    cockpits=cockpits, wheels=cockpits)
    server.fleet.set_mode(SIM_RACE_LAPS)  # a full race (contract: 5 laps), not a free run
    return server


def create_app(server=None, sim=None):
    """server: the real arena. sim: the SIMULAÇÃO arena (?simulacao=1), or None."""
    server = server or Server()
    app = web.Application(client_max_size=4096)

    def arena(request):
        if request.query.get('simulacao') != '1': return server
        if sim is None: raise web.HTTPNotFound(text='Simulação indisponível.')
        return sim

    def cors(request):
        origin = request.headers.get('Origin')
        host = urlsplit(origin or '').hostname
        return {'Access-Control-Allow-Origin': origin} if host and local_address(host) else {}

    async def health(request):
        number = int(request.query.get('vaga', '1')) if request.query.get('vaga', '1').isdigit() else 1
        port = request.url.port or 8080
        return web.json_response(dict(service='rc-cockpit', **arena(request).telemetry(number),
                                      lanUrls=[f'http://{a}:{port}' for a in lan_addresses()]), headers=cors(request))

    async def simulate(request):
        # SIMULAÇÃO arena only: unplug/plug virtual cars, from this PC.
        from backend import simulated
        if sim is None or not ipaddress.ip_address(request.remote).is_loopback: raise web.HTTPNotFound()
        ok = simulated.plug(request.query.get('porta', ''), request.query.get('acao') == 'plugar')
        return web.json_response(dict(ok=ok, plugados=sorted(simulated.PLUGGED)))

    async def ranking(request):
        return web.json_response(await asyncio.to_thread(arena(request).history.ranking), headers=cors(request))

    async def websocket(request):
        return await arena(request).websocket(request)

    async def index(_):
        if not (PANEL / 'index.html').exists(): raise web.HTTPServiceUnavailable(text='Execute npm run build em frontend/.')
        return web.FileResponse(PANEL / 'index.html', headers={'Cache-Control': 'no-store'})

    async def asset(request):
        base = PANEL.resolve()
        path = (base / request.match_info['path']).resolve()
        if not path.is_relative_to(base) or not path.is_file(): raise web.HTTPNotFound()
        return web.FileResponse(path)

    @web.middleware
    async def local_only(request, handler):
        if not local_address(request.remote or ''): raise web.HTTPForbidden(text='Somente a rede local do evento.')
        return await handler(request)

    async def lifecycle(_):
        arenas = [a for a in (server, sim) if a is not None]
        tasks = [asyncio.create_task(a.hardware_loop()) for a in arenas]
        yield
        for a in arenas:
            a.fleet.stop_all('Serviço encerrado.')
            for ws in list(a.clients): await ws.close(code=1001)
        for task in tasks:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError): await task

    app.middlewares.append(local_only)
    app.cleanup_ctx.append(lifecycle)
    app.router.add_get('/health', health)
    app.router.add_get('/api/ranking', ranking)
    app.router.add_post('/api/simular', simulate)
    app.router.add_get('/ws/telemetry', websocket)
    app.router.add_get('/', index)
    app.router.add_get('/{path:.*}', asset)
    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--host', default='0.0.0.0', help='0.0.0.0 = rede local (tablets); 127.0.0.1 = só este PC')
    parser.add_argument('--cockpits', type=int, default=None, help='quantos cockpits a instalação tem (1-16; padrão: o salvo, ou 4)')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    DATA.mkdir(parents=True, exist_ok=True)
    # Real arena (only what is plugged in) + SIMULAÇÃO arena (virtual cars, own database).
    web.run_app(create_app(Server(history=History(DB_FILE), cockpits=args.cockpits), simulation_server()),
                host=args.host, port=args.port)
