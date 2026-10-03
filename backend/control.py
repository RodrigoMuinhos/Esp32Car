"""Pure relay control logic. No hardware side effects; time is injectable.

Start: wheel A runs a 3-2-1 countdown and releases the car on GO, or holding
the throttle for 0.5 s starts at once. Finish: wheel B, or 15 s without
throttle. Safety stops (PARAR/ESC, wheel or ESP32 loss, invalid input) still
switch the relays off.
"""
import math

THROTTLE_THRESHOLD = 5
START_HOLD = 0.5
COUNTDOWN = 3.0
INACTIVITY = 15.0
MOVING_THROTTLE = 3
PANEL_INPUT_TIMEOUT = .4
ZERO = dict(steering=0, throttle=0, brake=0)
READY = 'Aperte A (ou segure o acelerador 0,5 s) para largar.'


class Controller:
    def __init__(self):
        self.connected = False
        self.armed = False
        self.buttons_down = dict(start=False, finish=False)
        self.panel_input = None
        self.panel_at = 0.0
        self.race_id = 0
        self.now = self.last_move = self.go_at = 0.0
        self.reset('idle', 'Aguardando ESP32.')

    def reset(self, phase, reason):
        self.phase = phase
        self.enabled = False
        self.mask = self.turn = self.drive = 0
        self.input = dict(ZERO)
        self.hold_since = None
        self.pulse_until = 0.0
        self.reason = reason
        # The throttle start only arms after the pedal is released, so a stop
        # never turns into an automatic restart while it is still pressed.
        self.armed = False

    def begin(self, now):
        self.phase = 'running'; self.enabled = True; self.hold_since = None
        self.race_id += 1; self.last_move = now
        self.reason = 'Corrida ativa. Aperte B para finalizar.'

    def stop(self, reason='Relés desligados.'):
        self.reset('finished' if self.phase in ('running', 'finished') else 'idle', reason)

    def countdown(self):
        """Seconds left before GO, for the HUD and the start beeps."""
        return max(0.0, self.go_at - self.now) if self.phase == 'countdown' else None

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
            self.panel_input = dict(steering=steering, throttle=throttle, brake=brake,
                                    start=data.get('start') is True, finish=data.get('finish') is True)
            self.panel_at = now

    def pressed(self, source, button):
        """True only on the press itself, so holding a button never repeats it."""
        down = source.get(button) is True
        was, self.buttons_down[button] = self.buttons_down[button], down
        return down and not was

    def tick(self, now, usb=None):
        """usb: live XInput reading (axes plus start/finish buttons), or None when no wheel is seen."""
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
            if self.phase in ('starting', 'countdown', 'running'): self.stop('Volante sem sinal. Corrida encerrada.')
            self.input = dict(ZERO)
            return
        start, finish = self.pressed(source, 'start'), self.pressed(source, 'finish')
        self.input = {k: source[k] for k in ZERO}
        throttle, brake, steering = source['throttle'], source['brake'], source['steering']
        if self.phase in ('idle', 'finished', 'starting'):
            if start:
                self.phase = 'countdown'; self.go_at = now + COUNTDOWN; self.hold_since = None
                self.reason = 'Prepare-se: 3, 2, 1...'
                return
            if throttle <= THROTTLE_THRESHOLD:
                if self.phase == 'starting':
                    self.phase = 'idle'; self.hold_since = None; self.reason = 'Início cancelado.'
                self.armed = True
                return
            if self.phase != 'starting':
                if not self.armed: return
                self.phase = 'starting'; self.hold_since = now; self.reason = 'Mantenha o acelerador.'
            if now - self.hold_since < START_HOLD: return
            self.begin(now)
        elif self.phase == 'countdown':
            if finish:
                self.reset('idle', 'Largada cancelada.'); return
            if now < self.go_at: return
            self.begin(now)
        elif finish:
            self.stop('Corrida finalizada pelo botão B.'); return
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
