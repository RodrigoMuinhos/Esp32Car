"""Pure relay control logic. No hardware side effects; time is injectable.

The race is started and finished only by the wheel buttons: A starts, B finishes.
Nothing starts or ends it automatically; safety stops (PARAR/ESC, wheel or ESP32
loss, invalid input) still switch the relays off.
"""
import math

PANEL_INPUT_TIMEOUT = .4
ZERO = dict(steering=0, throttle=0, brake=0)
READY = 'Aperte A no volante para largar.'


class Controller:
    def __init__(self):
        self.connected = False
        self.buttons_down = dict(start=False, finish=False)
        self.panel_input = None
        self.panel_at = 0.0
        self.race_id = 0
        self.reset('idle', 'Aguardando ESP32.')

    def reset(self, phase, reason):
        self.phase = phase
        self.enabled = False
        self.mask = self.turn = self.drive = 0
        self.input = dict(ZERO)
        self.pulse_until = 0.0
        self.reason = reason

    def begin(self):
        self.phase = 'running'; self.enabled = True
        self.race_id += 1; self.reason = 'Corrida ativa. Aperte B para finalizar.'

    def stop(self, reason='Relés desligados.'):
        self.reset('finished' if self.phase in ('running', 'finished') else 'idle', reason)

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
            if self.phase == 'running': self.stop('Volante sem sinal. Corrida encerrada.')
            self.input = dict(ZERO)
            return
        start, finish = self.pressed(source, 'start'), self.pressed(source, 'finish')
        self.input = {k: source[k] for k in ZERO}
        if self.phase != 'running':
            if start: self.begin()
            else: return
        elif finish:
            self.stop('Corrida finalizada pelo botão B.'); return
        throttle, brake, steering = source['throttle'], source['brake'], source['steering']
        # Hysteresis matches the existing relay controller (~15% / 8%).
        if steering >= 15: self.turn = 4
        elif steering <= -15: self.turn = 8
        elif (self.turn == 4 and steering <= 8) or (self.turn == 8 and steering >= -8): self.turn = 0
        if throttle >= 12: self.drive |= 1
        elif throttle <= 6: self.drive &= ~1
        if brake >= 12: self.drive |= 2
        elif brake <= 6: self.drive &= ~2
        self.mask = (0 if self.drive == 3 else self.drive) | self.turn
