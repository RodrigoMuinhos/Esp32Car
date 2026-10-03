"""RC Racing desktop app: starts the bridge, opens the panel in its own window
and exits once the window is closed and no race is running.

`RC Racing.exe --diagnostico` writes a machine report to the Desktop instead.
"""
import asyncio
import ctypes
import json
import logging
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
from logging.handlers import RotatingFileHandler
from pathlib import Path

from aiohttp import web
from backend import diagnose
from backend.server import Bridge, create_app

DATA = Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'RC Racing'
LOG_FILE = DATA / 'logs' / 'app.log'
FIRST_WINDOW_TIMEOUT = 90
CLOSE_GRACE = 5
LOG = logging.getLogger('rc-racing')


def url(port):
    return f'http://127.0.0.1:{port}'


def running_port():
    """Port of an RC Racing already running on this PC, or None."""
    for port in diagnose.PORTS:
        try:
            with urllib.request.urlopen(url(port) + '/health', timeout=.5) as response:
                if json.load(response).get('service') == 'rc-cockpit': return port
        except (OSError, ValueError):
            continue
    return None


def open_window(port):
    edge = diagnose.find_edge()
    if not edge:
        webbrowser.open(url(port)); return
    # Dedicated profile: an app-style window whose timers keep running in the background.
    subprocess.Popen([str(edge), f'--app={url(port)}', f'--user-data-dir={DATA / "janela"}', '--start-maximized',
                      '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
                      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
                      # Race sounds start from wheel buttons, which are not page clicks.
                      '--autoplay-policy=no-user-gesture-required'])


def alert(text):
    ctypes.windll.user32.MessageBoxW(0, text, 'RC Racing', 0x10)


def write_diagnostics():
    """Saves the machine report on the Desktop and opens it in Notepad."""
    desktop = Path(os.environ.get('USERPROFILE') or Path.home()) / 'Desktop'
    target = (desktop if desktop.exists() else DATA) / 'RC Racing - diagnostico.txt'
    target.write_text(diagnose.report(LOG_FILE), encoding='utf-8-sig')
    subprocess.Popen(['notepad.exe', str(target)])


async def serve():
    port = diagnose.free_port()
    if port is None:
        alert('As portas 8080 a 8089 estão ocupadas. Feche outros programas e abra o RC Racing novamente.')
        return
    bridge = Bridge('auto')
    runner = web.AppRunner(create_app(bridge))
    await runner.setup()
    await web.TCPSite(runner, '127.0.0.1', port).start()
    LOG.info('Servindo em %s', url(port))
    open_window(port)
    started, seen, idle_since = time.monotonic(), False, None
    try:
        while True:
            await asyncio.sleep(1)
            now = time.monotonic()
            seen = seen or bool(bridge.clients)
            racing = bridge.controller.phase in ('starting', 'countdown', 'running', 'pulse')
            if bridge.clients or racing or (not seen and now - started < FIRST_WINDOW_TIMEOUT):
                idle_since = None; continue
            idle_since = idle_since or now
            if now - idle_since >= CLOSE_GRACE:
                LOG.info('Janela fechada; encerrando.'); break
    finally:
        await runner.cleanup()  # stops the hardware loop, which switches the relays off


def main():
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(LOG_FILE, maxBytes=1_000_000, backupCount=2, encoding='utf-8')
    logging.basicConfig(level=logging.INFO, handlers=[handler], format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    logging.getLogger('aiohttp.access').setLevel(logging.WARNING)
    if '--diagnostico' in sys.argv:
        write_diagnostics(); return
    if (port := running_port()) is not None:
        open_window(port); return
    try:
        asyncio.run(serve())
    except Exception:
        LOG.exception('Falha inesperada')
        alert(f'O RC Racing encontrou um erro. Rode "RC Racing - Diagnóstico" no menu Iniciar.\n\nDetalhes em:\n{LOG_FILE}')
        sys.exit(1)


if __name__ == '__main__':
    main()
