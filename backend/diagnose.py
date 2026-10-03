"""Machine check for RC Racing: board, driver, wheel, browser and ports.

Used by the app (`RC Racing.exe --diagnostico` writes a report to the Desktop)
and by the bridge to explain why the board or the wheel is not found.
"""
import ctypes
import json
import os
import platform
import socket
import subprocess
from datetime import datetime
from pathlib import Path

from serial.tools import list_ports

ESP32_VID_PATTERN = 'VID_(10C4|1A86|0403|303A)'
PORTS = range(8080, 8090)
NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW


def _pnp(where):
    """Win32_PnPEntity rows matching a PowerShell Where-Object clause."""
    script = (f"Get-CimInstance Win32_PnPEntity | Where-Object {{ {where} }} | "
              "Select-Object Name, DeviceID, PNPClass, ConfigManagerErrorCode | ConvertTo-Json -Compress")
    try:
        out = subprocess.run(['powershell', '-NoProfile', '-Command', script], capture_output=True,
                             text=True, timeout=20, creationflags=NO_WINDOW).stdout.strip()
        rows = json.loads(out) if out else []
        return rows if isinstance(rows, list) else [rows]
    except (OSError, subprocess.SubprocessError, ValueError):
        return []


def board_devices():
    """ESP32 USB-serial chips plugged in, with or without a working driver."""
    return _pnp(f"$_.DeviceID -match '{ESP32_VID_PATTERN}'")


def board_without_driver():
    """A USB-serial chip of the board is present but Windows has no driver for it."""
    return [d for d in board_devices() if d.get('ConfigManagerErrorCode')]


def game_controllers():
    return _pnp("$_.Name -match 'game controller|controlador de jogo|XBOX 360|XInput|Logitech|G29|G920|G923|Driving Force|Thrustmaster|wheel|volante'")


def xinput_slots():
    class Pad(ctypes.Structure):
        _fields_ = [('buttons', ctypes.c_ushort), ('lt', ctypes.c_ubyte), ('rt', ctypes.c_ubyte),
                    ('lx', ctypes.c_short), ('ly', ctypes.c_short), ('rx', ctypes.c_short), ('ry', ctypes.c_short)]

    class State(ctypes.Structure):
        _fields_ = [('packet', ctypes.c_uint32), ('pad', Pad)]
    try:
        xinput = ctypes.WinDLL('xinput1_4.dll')
    except OSError:
        return None
    state = State()
    return [i for i in range(4) if xinput.XInputGetState(i, ctypes.byref(state)) == 0]


def wheel_hint(xinput_connected):
    """Plain-language hint when no XInput wheel is seen, or None."""
    if xinput_connected:
        return None
    devices = game_controllers()
    if any(d.get('ConfigManagerErrorCode') for d in devices):
        return 'Volante conectado, mas sem driver no Windows. Reconecte o cabo com internet ligada.'
    if devices:
        return 'Volante no modo D (DirectInput). Mude a chave do volante para X (XInput) e reconecte.'
    return 'Volante não detectado. Conecte o volante USB.'


def board_hint():
    """Plain-language hint when no ESP32 serial port is found."""
    if board_without_driver():
        return 'Placa ESP32 conectada, mas sem driver. Rode o instalador do RC Racing (ele instala o driver CP210x).'
    return 'ESP32 não encontrado. Conecte o cabo USB da placa.'


def free_port():
    for port in PORTS:
        with socket.socket() as s:
            try:
                s.bind(('127.0.0.1', port)); return port
            except OSError:
                continue
    return None


def find_edge():
    for base in (os.environ.get('ProgramFiles(x86)'), os.environ.get('ProgramFiles'), os.environ.get('LOCALAPPDATA')):
        if base and (path := Path(base) / 'Microsoft/Edge/Application/msedge.exe').exists():
            return path
    return None


def report(log_file=None):
    """Full machine report in Portuguese, with a verdict and what to do."""
    ok, problems, lines = [], [], []
    add = lines.append
    add(f'RC Racing - diagnóstico  ({datetime.now():%d/%m/%Y %H:%M})')
    add(f'Windows: {platform.platform()}  |  computador: {platform.node()}')
    add('')

    edge = find_edge()
    add(f'Microsoft Edge: {edge or "NÃO encontrado"}')
    (ok if edge else problems).append('Edge instalado (abre a janela do painel)' if edge else
                                      'Edge não encontrado: o painel abrirá no navegador padrão (instale o Microsoft Edge).')

    add('')
    add('Portas seriais (COM):')
    ports = list(list_ports.comports())
    for p in ports:
        add(f'  {p.device}: {p.description}  [VID={p.vid and hex(p.vid)} PID={p.pid and hex(p.pid)}]')
    if not ports:
        add('  nenhuma')
    add('Chips USB da placa (CP210x/CH340/FTDI/Espressif):')
    devices = board_devices()
    for d in devices:
        code = d.get('ConfigManagerErrorCode')
        add(f'  {d.get("Name")}  ->  {"OK" if not code else f"ERRO {code} (sem driver)" if code == 28 else f"ERRO {code}"}')
    if not devices:
        add('  nenhum')
    esp_ports = [p for p in ports if p.vid in (0x10C4, 0x1A86, 0x0403, 0x303A)]
    if esp_ports:
        ok.append(f'Placa ESP32 na {esp_ports[0].device}')
    elif any(d.get('ConfigManagerErrorCode') for d in devices):
        problems.append('Placa conectada SEM driver: rode o instalador do RC Racing como administrador '
                        '(ele instala o driver CP210x) e reconecte o cabo.')
    else:
        problems.append('Placa ESP32 não encontrada: confira o cabo USB (precisa ser cabo de dados, não só de carga) '
                        'e troque de porta USB.')

    add('')
    slots = xinput_slots()
    add(f'Controles XInput conectados: {slots if slots is not None else "XInput indisponível"}')
    add('Controles/volantes vistos pelo Windows:')
    controllers = game_controllers()
    for d in controllers:
        code = d.get('ConfigManagerErrorCode')
        add(f'  {d.get("Name")}  ->  {"OK" if not code else f"ERRO {code}"}')
    if not controllers:
        add('  nenhum')
    hint = wheel_hint(bool(slots))
    (problems.append(hint) if hint else ok.append('Volante em modo XInput'))

    add('')
    port = free_port()
    add(f'Porta local livre para o painel: {port or "nenhuma entre 8080 e 8089"}')
    if port is None:
        problems.append('Portas 8080 a 8089 ocupadas: feche outros programas ou o RC Racing já aberto.')

    if log_file and Path(log_file).exists():
        add('')
        add(f'Últimas linhas do log ({log_file}):')
        tail = [line for line in Path(log_file).read_text(encoding='utf-8', errors='replace').splitlines()
                if 'aiohttp.access' not in line][-15:]
        lines.extend('  ' + line[:200] for line in tail)

    verdict = ['=' * 60, 'RESULTADO', '=' * 60]
    verdict += [f'  [OK] {item}' for item in ok]
    verdict += [f'  [!!] {item}' for item in problems]
    verdict += ['', 'Tudo certo: abra o RC Racing e aperte A no volante.' if not problems else
                'Resolva os itens [!!] acima e abra o RC Racing de novo.', '']
    return '\n'.join(verdict + lines) + '\n'
