"""Pure relay control logic. No hardware side effects; time is injectable.

The race starts and ends from the physical pedals alone:
hold throttle 0.3 s -> start; hold brake 5 s -> finish; 10 s without throttle -> finish.
"""
import math

THROTTLE_THRESHOLD = 5
BRAKE_THRESHOLD = 10
START_HOLD = 0.3
STOP_HOLD = 5.0
INACTIVITY = 10.0
MOVING_THROTTLE = 3
PANEL_INPUT_TIMEOUT = .4
ZERO = dict(steering=0, throttle=0, brake=0)
READY = 'Segure o acelerador por 0,3 s para largar.'


class Controller:
    def __init__(self):
        self.connected = False
        self.armed = False
        self.panel_input = None
        self.panel_at = 0.0
        self.race_id = 0
        self.now = self.last_move = 0.0
        self.reset('idle', 'Aguardando ESP32.')

    def reset(self, phase, reason):
        self.phase = phase
        self.enabled = False
        self.mask = self.turn = self.drive = 0
        self.input = dict(ZERO)
        self.hold_since = self.brake_since = None
        self.pulse_until = 0.0
        self.reason = reason
        # A new race only arms after the throttle is released, so a stop never
        # turns into an automatic restart while the pedal is still pressed.
        self.armed = False

    def stop(self, reason='Relés desligados.'):
        self.reset('finished' if self.phase in ('running', 'finished') else 'idle', reason)

    def hold(self):
        """Remaining seconds of the current pedal hold, for the HUD."""
        if self.phase == 'starting' and self.hold_since is not None:
            return dict(action='start', remaining=max(0.0, START_HOLD - (self.now - self.hold_since)))
        if self.phase == 'running' and self.brake_since is not None:
            return dict(action='stop', remaining=max(0.0, STOP_HOLD - (self.now - self.brake_since)))
        return None

    def message(self, message, now):
        if not isinstance(message, dict) or not isinstance(message.get('data'), dict):
            self.stop('Comando inválido.'); return
        kind, data = message.get('type'), message['data']
        if kind == 'stop' or (kind == 'enable' and data.get('carEnabled') is False):
            self.stop('Corrida encerrada pelo painel.' if self.phase == 'running' else 'Relés desligados.'); return
        if kind == 'relay':
            relay = data.get('relay')
            if not self.connected or self.phase not in ('idle', 'finished') or type(relay) is not int or relay not in (1, 2, 3, 4): return
            self.reset('pulse', f'Testando K{relay} por 0,5 s.')
            self.mask = 1 << (relay - 1); self.pulse_until = now + .5
        elif kind == 'control':
            # Fallback input from the panel (browser gamepad) when Windows/XInput has no wheel.
            values = [data.get(k) for k in ('steering', 'throttle', 'brake')]
            if any(type(v) not in (float, int) or not math.isfinite(v) for v in values):
                self.stop('Comando inválido.'); return
            steering, throttle, brake = values
            if not (-100 <= steering <= 100 and 0 <= throttle <= 100 and 0 <= brake <= 100):
                self.stop('Comando fora dos limites.'); return
            self.panel_input = dict(steering=steering, throttle=throttle, brake=brake); self.panel_at = now

    def tick(self, now, usb=None):
        """usb: live XInput reading, or None when no wheel is seen by Windows."""
        self.now = now
        if not self.connected:
            if self.phase != 'idle' or self.mask: self.reset('idle', 'ESP32 desconectado.')
            return
        if self.reason in ('Aguardando ESP32.', 'ESP32 desconectado.'): self.reason = READY
        if self.phase == 'pulse':
            if now >= self.pulse_until: self.reset('idle', 'Teste concluído. Relés desligados.')
            return
        source = usb
        if source is None and self.panel_input and now - self.panel_at <= PANEL_INPUT_TIMEOUT:
            source = self.panel_input
        if source is None:
            if self.phase in ('starting', 'running'): self.stop('Volante sem sinal. Corrida encerrada.')
            self.input = dict(ZERO)
            return
        self.input = dict(source)
        throttle, brake, steering = source['throttle'], source['brake'], source['steering']
        if self.phase in ('idle', 'finished'):
            if throttle <= THROTTLE_THRESHOLD: self.armed = True
            elif self.armed:
                self.phase = 'starting'; self.hold_since = now; self.reason = 'Mantenha o acelerador.'
            return
        if self.phase == 'starting':
            if throttle <= THROTTLE_THRESHOLD:
                self.phase = 'idle'; self.hold_since = None; self.reason = 'Início cancelado.'
                return
            if now - self.hold_since < START_HOLD: return
            self.phase = 'running'; self.enabled = True; self.hold_since = None
            self.race_id += 1; self.last_move = now; self.reason = 'Corrida ativa.'
        # running
        if brake > BRAKE_THRESHOLD:
            if self.brake_since is None: self.brake_since = now
            if now - self.brake_since >= STOP_HOLD:
                self.stop('Corrida finalizada pelo freio.'); return
        else: self.brake_since = None
        if throttle > MOVING_THROTTLE: self.last_move = now
        elif now - self.last_move >= INACTIVITY:
            self.stop('Corrida finalizada por inatividade.'); return
        # Hysteresis matches the existing relay controller (~15% / 8%).
        if steering >= 15: self.turn = 4
        elif steering <= -15: self.turn = 8
        elif (self.turn == 4 and steering <= 8) or (self.turn == 8 and steering >= -8): self.turn = 0
        if throttle >= 12: self.drive |= 1
        elif throttle <= 6: self.drive &= ~1
        if brake >= 12: self.drive |= 2
        elif brake <= 6: self.drive &= ~2
        self.mask = (0 if self.drive == 3 else self.drive) | self.turn
