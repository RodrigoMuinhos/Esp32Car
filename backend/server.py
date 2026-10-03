"""Single-owner WebSocket/serial bridge, with live Windows XInput monitoring."""
import argparse
import asyncio
import contextlib
import ctypes
import json
import logging
import sys
import time
from pathlib import Path

import serial
from serial.tools import list_ports
from aiohttp import web, WSMsgType
from backend.control import Controller

# Packaged app (PyInstaller) unpacks the frontend next to the executable.
ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
# USB-serial chips used by ESP32 boards: CP210x, CH340/CH9102, FTDI, Espressif native USB.
ESP32_VIDS = {0x10C4, 0x1A86, 0x0403, 0x303A}
# XInput button that starts the race (A on the Logitech wheel).
START_BUTTON = 0x1000


def find_ports():
    """Candidate ESP32 ports, most likely first; Bluetooth serial ports are skipped."""
    ports = [p for p in list_ports.comports() if p.vid is not None and 'BTHENUM' not in (p.hwid or '').upper()]
    ports.sort(key=lambda p: p.vid not in ESP32_VIDS)
    return [p.device for p in ports]
ALLOWED_ORIGINS = {f'http://{host}:{port}' for host in ('localhost', '127.0.0.1') for port in (8080, 5173)}
LOG = logging.getLogger('cockpit')


class Pad(ctypes.Structure):
    _fields_ = [('buttons', ctypes.c_ushort), ('lt', ctypes.c_ubyte), ('rt', ctypes.c_ubyte),
                ('lx', ctypes.c_short), ('ly', ctypes.c_short), ('rx', ctypes.c_short), ('ry', ctypes.c_short)]


class PadState(ctypes.Structure):
    _fields_ = [('packet', ctypes.c_uint32), ('pad', Pad)]


class Bridge:
    def __init__(self, port='auto', serial_factory=serial.Serial):
        self.auto = port == 'auto'
        self.port_name = 'USB' if self.auto else port
        self.attempt = 0
        self.serial_factory = serial_factory
        self.port = None
        self.controller = Controller()
        self.buffer = b''
        self.hello = False
        self.confirmed = None
        self.last_ack = 0.0
        self.last_match = 0.0
        self.last_write = 0.0
        self.sent_mask = -1
        self.opened = 0.0
        self.retry_at = 0.0
        self.error = 'Conectando ao ESP32...'
        self.clients = []
        self.owner = None
        self.usb_connected = False
        self.usb_input = dict(steering=0, throttle=0, brake=0)
        self.usb_start = False
        try:
            self.xinput = ctypes.WinDLL('xinput1_4.dll')
            self.xinput.XInputGetState.argtypes = [ctypes.c_uint32, ctypes.POINTER(PadState)]
            self.xinput.XInputGetState.restype = ctypes.c_uint32
        except (AttributeError, OSError): self.xinput = None

    def read_usb(self):
        state = PadState()
        self.usb_connected = False
        if self.xinput:
            for index in range(4):
                if self.xinput.XInputGetState(index, ctypes.byref(state)) == 0:
                    self.usb_connected = True; break
        p = state.pad
        self.usb_input = dict(steering=max(-100, min(100, p.lx / 32767 * 100)),
                              throttle=100 if p.buttons & 512 else p.rt / 255 * 100,
                              brake=100 if p.buttons & 256 else p.lt / 255 * 100) if self.usb_connected else dict(steering=0, throttle=0, brake=0)
        self.usb_start = self.usb_connected and bool(p.buttons & START_BUTTON)

    def disconnect(self, reason):
        self.controller.connected = False
        self.controller.stop(reason)
        if self.port:
            with contextlib.suppress(Exception): self.port.write(b'S')
            with contextlib.suppress(Exception): self.port.close()
        self.port = None; self.hello = False; self.confirmed = None
        self.error = reason; self.retry_at = time.monotonic() + 2

    def pump(self, now):
        """Only called from the hardware loop: single serial reader/writer."""
        self.buffer += self.port.read(4096)
        while b'\n' in self.buffer:
            line, self.buffer = self.buffer.split(b'\n', 1)
            text = line.decode('utf-8', errors='replace').strip()
            if text == 'Pronto CONTROLE v5':
                if self.hello and self.controller.phase != 'idle': self.controller.stop('ESP32 reiniciou. Inicie novamente.')
                self.hello = True
            elif text.startswith('ESTADO '):
                try: mask = int(text.split()[1])
                except (ValueError, IndexError): continue
                if not 0 <= mask <= 15 or mask & 3 == 3 or mask & 12 == 12: continue
                self.confirmed = mask; self.last_ack = now
                if mask == self.controller.mask: self.last_match = now
        if len(self.buffer) > 8192: self.buffer = b''
        self.controller.connected = self.hello and self.confirmed is not None and now - self.last_ack < .75
        if self.controller.connected: self.error = ''
        if self.hello and self.confirmed is not None and now - self.last_ack >= .75:
            raise serial.SerialException('ESP32 sem confirmação. Reconectando.')
        if not self.controller.connected and now - self.opened > 8:
            raise serial.SerialException('Firmware não respondeu como CONTROLE v5.')
        self.controller.tick(now, dict(self.usb_input, start=self.usb_start) if self.usb_connected else None)
        desired = self.controller.mask
        if desired != self.sent_mask:
            self.last_match = now
        elif self.controller.connected and now - self.last_match >= .75:
            raise serial.SerialException('Relés não confirmaram o comando. Reconectando.')
        if desired != self.sent_mask or now - self.last_write >= .15:
            self.port.write(bytes([ord('a') + desired]) if self.hello else b'?S')
            self.sent_mask = desired; self.last_write = now

    async def hardware_loop(self):
        try:
            while True:
                self.read_usb()
                now = time.monotonic()
                try:
                    if not self.port and now >= self.retry_at and self.auto:
                        # Try each candidate in turn; the handshake rejects non-ESP32 devices.
                        candidates = find_ports()
                        if candidates:
                            self.port_name = candidates[self.attempt % len(candidates)]; self.attempt += 1
                        else:
                            self.error = 'ESP32 não encontrado. Conecte o cabo USB da placa.'
                            self.retry_at = now + 1
                    if not self.port and now >= self.retry_at:
                        self.port = await asyncio.to_thread(self.serial_factory, self.port_name, 115200, timeout=0, write_timeout=.1)
                        self.opened = time.monotonic(); self.buffer = b''; self.sent_mask = -1
                        self.last_ack = self.last_match = self.opened
                    if self.port: self.pump(time.monotonic())
                except (serial.SerialException, OSError) as error:
                    self.disconnect(f'{self.port_name}: {error}')
                await asyncio.sleep(.02)
        finally: self.disconnect('Serviço encerrado.')

    def telemetry(self, client=None):
        c = self.controller
        return dict(connected=c.connected, carEnabled=c.enabled, **c.input,
                    speed=None, battery=None, signal=None, temperature=None, position=None,
                    relayMask=self.confirmed if c.connected else None, requestedMask=c.mask,
                    port=self.port_name, controlAvailable=client is not None and client is self.owner,
                    usbConnected=self.usb_connected, usbInput=self.usb_input,
                    phase=c.phase, hold=c.hold(), raceId=c.race_id, status=self.error or c.reason)

    async def websocket(self, request):
        if request.headers.get('Origin') not in ALLOWED_ORIGINS:
            raise web.HTTPForbidden(text='Origem não autorizada.')
        ws = web.WebSocketResponse(max_msg_size=4096, heartbeat=2)
        await ws.prepare(request)
        self.clients.append(ws)
        if self.owner is None: self.owner = ws
        async def publish():
            while not ws.closed:
                await ws.send_json(dict(type='telemetry', data=self.telemetry(ws)))
                await asyncio.sleep(.05)
        task = asyncio.create_task(publish())
        try:
            async for message in ws:
                if message.type != WSMsgType.TEXT: continue
                try: payload = json.loads(message.data)
                except (ValueError, TypeError):
                    if ws is self.owner: self.controller.stop('Mensagem inválida.')
                    continue
                if isinstance(payload, dict) and payload.get('type') == 'claim' and payload.get('data') == {}:
                    self.controller.stop('Controle assumido nesta janela.'); self.owner = ws
                    continue
                # Any window may stop the car; only the owner may send other commands.
                is_stop = isinstance(payload, dict) and (payload.get('type') == 'stop' or (
                    payload.get('type') == 'enable' and isinstance(payload.get('data'), dict) and payload['data'].get('carEnabled') is False))
                if ws is not self.owner and not is_stop: continue
                self.controller.message(payload, time.monotonic())
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception): await task
            self.clients.remove(ws)
            # The race is driven by the pedals, so closing the panel does not stop it.
            if self.owner is ws:
                self.controller.panel_input = None
                self.owner = self.clients[0] if self.clients else None
        return ws


def create_app(bridge=None):
    bridge = bridge or Bridge()
    app = web.Application(client_max_size=4096)
    async def health(_):
        return web.json_response(dict(service='rc-cockpit', **bridge.telemetry()))
    async def index(_):
        if not (ROOT / 'dist/index.html').exists(): raise web.HTTPServiceUnavailable(text='Execute npm run build.')
        return web.FileResponse(ROOT / 'dist/index.html', headers={'Cache-Control': 'no-store'})
    async def asset(request):
        base = (ROOT / 'dist').resolve()
        path = (base / request.match_info['path']).resolve()
        if not path.is_relative_to(base) or not path.is_file(): raise web.HTTPNotFound()
        return web.FileResponse(path)
    async def lifecycle(_):
        task = asyncio.create_task(bridge.hardware_loop())
        yield
        bridge.controller.stop('Serviço encerrado.')
        for ws in list(bridge.clients): await ws.close(code=1001)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError): await task
    app.cleanup_ctx.append(lifecycle)
    app.router.add_get('/health', health)
    app.router.add_get('/ws/telemetry', bridge.websocket)
    app.router.add_get('/', index)
    app.router.add_get('/{path:.*}', asset)
    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial-port', default='auto', help='COMx, ou auto para detectar o ESP32')
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    web.run_app(create_app(Bridge(args.serial_port)), host='127.0.0.1', port=args.port)
