"""Virtual ESP32 boards (firmware v6) and drivers: the SIMULAÇÃO arena.

The server runs a second, separate fleet for the panel's SIMULAÇÃO mode (its own
database): ports SIM1..SIMn behave like plugged-in cars and confirm every relay
command like the real firmware. The real fleet never sees them.
POST /api/simular?porta=SIM2&acao=desplugar|plugar simulates a broken car and a
spare (the ports after the cockpits are spares, unplugged at first).
"""
import serial


PLUGGED = set()
MAX_PORTS = 24  # 16 cockpits + spares


class SimulatedBoard:
    def __init__(self, port):
        self.port = port
        self.board_id = f'SIMULADO{port[3:]:0>2}'
        self.buffer = self.hello()
        self.mask = 0

    def hello(self):
        return f'Pronto CONTROLE v6 ID {self.board_id}\nESTADO 0\n'.encode()

    def read(self, _):
        if self.port not in PLUGGED: raise serial.SerialException('cabo desconectado')
        out, self.buffer = self.buffer, b''
        return out

    def write(self, data):
        for c in data:
            if 97 <= c <= 112:
                mask = c - 97
                if mask & 3 == 3: mask &= ~3
                if mask & 12 == 12: mask &= ~12
                self.mask = mask
                self.buffer += f'ESTADO {mask}\n'.encode()
            elif c == ord('S'):
                self.mask = 0; self.buffer += b'ESTADO 0\n'
            elif c == ord('?'):
                self.buffer += self.hello()

    def close(self):
        pass


def with_simulated(count, real_ports, real_factory=serial.Serial):
    """Port lister and serial factory that add SIM1..SIMn to the real ones."""
    names = [f'SIM{i}' for i in range(1, MAX_PORTS + 1)]
    PLUGGED.update(names[:count])

    def ports():
        return real_ports() + [n for n in names if n in PLUGGED]

    def factory(port, *args, **kwargs):
        return SimulatedBoard(port) if port in names else real_factory(port, *args, **kwargs)
    return ports, factory


class AutoPilot:
    """Simulated drivers for the wheels that are not plugged in (test mode only).

    Each one throttles and steers in its own rhythm and marks a lap every few
    seconds while its car is racing, so a full 4-car race can be watched.
    """

    LAP_SECONDS = (9.0, 9.8, 10.6, 11.5)

    def __init__(self):
        self.next_lap = {}

    def fill(self, pads, now, fleet):
        import math
        pads = list(pads)
        for index in range(len(pads)):
            if pads[index] is not None or index not in fleet.pad_map: continue
            slot = fleet.slots[fleet.pad_map.index(index)]
            racing = slot.controller.phase == 'running'
            lap = False
            rhythm = self.LAP_SECONDS[index % len(self.LAP_SECONDS)]
            if racing:
                if self.next_lap.get(index) is None: self.next_lap[index] = now + rhythm
                elif now >= self.next_lap[index]:
                    lap = True
                    self.next_lap[index] = now + rhythm * (0.92 + 0.16 * ((now * 7.3 + index) % 1))
            else:
                self.next_lap[index] = None
            pads[index] = dict(
                steering=70 * math.sin(now * (0.7 + 0.15 * index) + index),
                throttle=(70 + 30 * math.sin(now * (1.1 + 0.2 * index))) if racing else 0,
                brake=0, start=False, finish=False, panic=False, lap=lap)
            # Technical acceptance: the virtual driver turns the wheel and presses the pedals when asked.
            current = slot.acceptance.current
            if current in ('steering', 'pedals'):
                phase = int(now * 2) % 4
                if current == 'steering': pads[index].update(steering=(-100, 100, 0, 0)[phase])
                else: pads[index].update(throttle=100 if phase == 1 else 0, brake=100 if phase == 3 else 0)
            # Setup wizard: the virtual driver of that slot holds A+B, then turns the
            # wheel both ways and presses both pedals, like an operator would.
            setup = fleet.setup
            if setup and fleet.pad_map[setup['slot'] - 1] == index:
                if setup['step'] == 'sync':
                    pads[index].update(start=True, finish=True)
                elif setup['step'] == 'confirm':
                    phase = int(now) % 4
                    pads[index].update(steering=(-100, 100, 0, 0)[phase], throttle=100 if phase == 2 else 0,
                                       brake=100 if phase == 3 else 0)
        return pads


def plug(port, plugged):
    """Test mode: unplug a virtual car (it "breaks") or plug one in."""
    if not (port.startswith('SIM') and port[3:].isdigit() and 1 <= int(port[3:]) <= MAX_PORTS): return False
    (PLUGGED.add if plugged else PLUGGED.discard)(port)
    return True
