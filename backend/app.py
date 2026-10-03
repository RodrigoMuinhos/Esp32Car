"""RC Racing desktop app: starts the bridge, opens the panel in its own window
and exits once the window is closed and no race is running."""
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
from backend.server import Bridge, create_app

PORT = 8080
URL = f'http://127.0.0.1:{PORT}'
DATA = Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'RC Racing'
FIRST_WINDOW_TIMEOUT = 90
CLOSE_GRACE = 5
LOG = logging.getLogger('rc-racing')


def already_running():
    try:
        with urllib.request.urlopen(URL + '/health', timeout=1) as response:
            return json.load(response).get('service') == 'rc-cockpit'
    except (OSError, ValueError):
        return False


def find_edge():
    for base in (os.environ.get('ProgramFiles(x86)'), os.environ.get('ProgramFiles'), os.environ.get('LOCALAPPDATA')):
        if base and (path := Path(base) / 'Microsoft/Edge/Application/msedge.exe').exists():
            return path
    return None


def open_window():
    edge = find_edge()
    if not edge:
        webbrowser.open(URL); return
    # Dedicated profile: an app-style window whose timers keep running in the background.
    subprocess.Popen([str(edge), f'--app={URL}', f'--user-data-dir={DATA / "janela"}', '--start-maximized',
                      '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
                      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
                      # Race sounds start from wheel buttons, which are not page clicks.
                      '--autoplay-policy=no-user-gesture-required'])


def alert(text):
    ctypes.windll.user32.MessageBoxW(0, text, 'RC Racing', 0x10)


async def serve():
    bridge = Bridge('auto')
    runner = web.AppRunner(create_app(bridge))
    await runner.setup()
    try:
        await web.TCPSite(runner, '127.0.0.1', PORT).start()
    except OSError:
        await runner.cleanup()
        alert(f'A porta {PORT} está em uso por outro programa. Feche-o e abra o RC Racing novamente.')
        return
    LOG.info('Servindo em %s', URL)
    open_window()
    started, seen, idle_since = time.monotonic(), False, None
    try:
        while True:
            await asyncio.sleep(1)
            now = time.monotonic()
            seen = seen or bool(bridge.clients)
            racing = bridge.controller.phase in ('starting', 'running', 'pulse')
            if bridge.clients or racing or (not seen and now - started < FIRST_WINDOW_TIMEOUT):
                idle_since = None; continue
            idle_since = idle_since or now
            if now - idle_since >= CLOSE_GRACE:
                LOG.info('Janela fechada; encerrando.'); break
    finally:
        await runner.cleanup()  # stops the hardware loop, which switches the relays off


def main():
    (DATA / 'logs').mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(DATA / 'logs' / 'app.log', maxBytes=1_000_000, backupCount=2, encoding='utf-8')
    logging.basicConfig(level=logging.INFO, handlers=[handler], format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    if already_running():
        open_window(); return
    try:
        asyncio.run(serve())
    except Exception:
        LOG.exception('Falha inesperada')
        alert(f'O RC Racing encontrou um erro. Detalhes em:\n{DATA / "logs" / "app.log"}')
        sys.exit(1)


if __name__ == '__main__':
    main()
