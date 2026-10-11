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
MIN_LAP = 1.0  # seconds; ignores double clicks on the lap flag
MIN_RACE = 1.0  # shorter races are not saved to the history
TARGET_LAPS = (0, 3, 5)  # free race, or time trial over 3 / 5 laps
# Relay self-test: K1..K4 one at a time, pulses short enough to barely move the car.
SELFTEST_PULSE = .12
SELFTEST_STEP = .37
PANEL_INPUT_TIMEOUT = .4
# Relay thresholds with hysteresis (%, on / off): the dead zone shown in the Central Técnica.
STEER_ON, STEER_OFF = 15, 8
PEDAL_ON, PEDAL_OFF = 12, 6
ZERO = dict(steering=0, throttle=0, brake=0)
READY = 'Aperte A (ou segure o acelerador 0,5 s) para largar.'
PANIC = 'Parada de emergência (botão X).'


class Controller:
    def __init__(self):
        self.connected = False
        self.armed = False
        self.buttons_down = dict(start=False, finish=False, panic=False, lap=False)
        # Time trial: the race ends by itself after this many laps (0 = free race).
        self.target_laps = 0
        self.panel_input = None
        self.panel_at = 0.0
        self.race_id = 0
        self.now = self.last_move = self.go_at = self.race_start = self.selftest_start = 0.0
        self.selftest_completed = False
        self.selftest_index, self.selftest_since = 0, None
        # Why this car must not start (e.g. battery at 5%), or None: no start while set.
        self.blocked = None
        self.laps = []
        # Result of the race that just ended, for the history; the bridge takes it.
        self.finished_race = None
        self.phase = 'idle'
        self.reset('idle', 'Aguardando ESP32.')

    def reset(self, phase, reason, end=None):
        if self.phase == 'running':
            # Any way out of a running race (B, idle, PARAR, lost wheel/board) ends it.
            end = self.now if end is None else end
            if end - self.race_start >= MIN_RACE:
                marks = [self.race_start] + self.laps
                self.finished_race = dict(
                    duration_ms=round((end - self.race_start) * 1000),
                    laps_ms=[round((b - a) * 1000) for a, b in zip(marks, marks[1:])],
                    reason=reason, target_laps=self.target_laps,
                    completed=bool(self.target_laps) and len(self.laps) >= self.target_laps)
        self.phase = phase
        self.enabled = False
        self.mask = self.turn = self.drive = 0
        self.test_mask = 0
        self.input = dict(ZERO)
        self.hold_since = None
        self.pulse_until = 0.0
        self.reason = reason
        # The throttle start only arms after the pedal is released, so a stop
        # never turns into an automatic restart while it is still pressed.
        self.armed = False

    def begin(self, now):
        self.phase = 'running'; self.enabled = True; self.hold_since = None
        self.race_id += 1; self.last_move = self.race_start = now; self.laps = []
        self.reason = 'Corrida ativa. Aperte B para finalizar.'

    def stop(self, reason='Relés desligados.', end=None):
        self.reset('finished' if self.phase in ('running', 'finished') else 'idle', reason, end)

    def start_self_test(self, now):
        """Pulses K1..K4 in turn; the bridge checks the ESP32 confirms each one."""
        if not self.connected or self.phase not in ('idle', 'finished'): return False
        self.reset('selftest', 'Autoteste dos relés: K1, K2, K3, K4...')
        self.selftest_start = now; self.selftest_completed = False
        self.selftest_index, self.selftest_since = 0, None
        return True

    def start_test(self, now, reason):
        """Technical acceptance: the relays follow test_mask (set by the acceptance) until end_test.
        Any stop (PARAR, wheel X, lost board) ends it, like any other phase."""
        if not self.connected or self.phase not in ('idle', 'finished'): return False
        self.reset('test', reason); self.test_mask = 0
        return True

    def end_test(self, reason):
        if self.phase == 'test': self.reset('idle', reason)

    def selftest_step(self):
        """Index (0..3) of the relay being pulsed now, or None between pulses.
        Each relay's time starts at the first tick that commands it, so a slow tick
        (busy PC, many boards starting at once) delays the test but never skips a relay."""
        if self.selftest_index >= 4: return None
        if self.selftest_since is None: self.selftest_since = self.now
        elapsed = self.now - self.selftest_since
        if elapsed >= SELFTEST_STEP:
            self.selftest_index += 1; self.selftest_since = self.now
            return self.selftest_step()
        return self.selftest_index if elapsed < SELFTEST_PULSE else None

    def set_blocked(self, reason):
        """Blocks every start (wheel A, throttle hold, operator) while reason is set.
        A race already running goes on; a countdown or throttle hold is cancelled."""
        if reason == self.blocked: return
        was, self.blocked = self.blocked, reason
        if reason and self.phase in ('idle', 'finished', 'starting', 'countdown'):
            if self.phase in ('starting', 'countdown'): self.phase = 'idle'; self.hold_since = None
            self.reason = reason
        elif not reason and self.reason == was:
            self.reason = READY

    def start_countdown(self, now):
        """3-2-1 then GO: from wheel A, or from the operator for all cars at once."""
        if not self.connected or self.phase not in ('idle', 'finished', 'starting'): return False
        if self.blocked: self.reason = self.blocked; return False
        self.now = max(self.now, now)
        self.phase = 'countdown'; self.go_at = now + COUNTDOWN; self.hold_since = None
        self.reason = 'Prepare-se: 3, 2, 1...'
        return True

    def race_times(self, now):
        """Live timing of the running race (ms), for the classification of the 4 cars."""
        if self.phase != 'running':
            return dict(elapsedMs=None, laps=0, bestLapMs=None, lastLapMs=None, lastMarkMs=None)
        marks = [self.race_start] + self.laps
        laps = [b - a for a, b in zip(marks, marks[1:])]
        return dict(elapsedMs=round((now - self.race_start) * 1000), laps=len(laps),
                    bestLapMs=round(min(laps) * 1000) if laps else None,
                    lastLapMs=round(laps[-1] * 1000) if laps else None,
                    lastMarkMs=round((marks[-1] - self.race_start) * 1000))

    def countdown(self):
        """Seconds left before GO, for the HUD and the start beeps."""
        return max(0.0, self.go_at - self.now) if self.phase == 'countdown' else None

    def message(self, message, now):
        self.now = max(self.now, now)
        if not isinstance(message, dict) or not isinstance(message.get('data'), dict):
            self.stop('Comando inválido.'); return
        kind, data = message.get('type'), message['data']
        if kind == 'stop' or (kind == 'enable' and data.get('carEnabled') is False):
            self.stop('Corrida encerrada pelo painel.' if self.phase == 'running' else 'Relés desligados.'); return
        if kind == 'lap':
            self.add_lap(now); return
        if kind == 'mode':
            laps = data.get('laps')
            if type(laps) is int and laps in TARGET_LAPS and self.phase not in ('countdown', 'running'):
                self.target_laps = laps
            return
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
                                    start=data.get('start') is True, finish=data.get('finish') is True,
                                    panic=data.get('panic') is True, lap=data.get('lap') is True)
            self.panel_at = now

    def add_lap(self, now):
        """Lap flag (panel) or wheel Y; in a time trial the last lap finishes the race."""
        last = self.laps[-1] if self.laps else self.race_start
        if self.phase != 'running' or now - last < MIN_LAP: return
        self.laps.append(now); self.last_move = now
        if self.target_laps and len(self.laps) >= self.target_laps:
            self.stop(f'Corrida concluída: {self.target_laps} voltas.', end=now)

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
        source = usb
        if source is None and self.panel_input and now - self.panel_at <= PANEL_INPUT_TIMEOUT:
            source = self.panel_input
        if source is not None and source.get('panic') is True:
            # Panic (wheel X): everything off at once, and nothing starts while it is held.
            if self.phase not in ('idle', 'finished') or self.mask: self.stop(PANIC)
            for button in ('start', 'finish', 'lap'): self.pressed(source, button)
            self.input = {k: source[k] for k in ZERO}
            return
        if self.phase == 'pulse':
            if now >= self.pulse_until: self.reset('idle', 'Teste concluído. Relés desligados.')
            return
        if self.phase == 'test':
            # Never two opposite relays at once, whatever the test asks for.
            mask = self.test_mask & 15
            self.mask = mask & ~(3 if mask & 3 == 3 else 0) & ~(12 if mask & 12 == 12 else 0)
            if source is not None: self.input = {k: source[k] for k in ZERO}
            return
        if self.phase == 'selftest':
            step = self.selftest_step()
            if self.selftest_index >= 4:
                self.selftest_completed = True
                self.reset('idle', 'Autoteste concluído. Relés desligados.')
            else:
                self.mask = 0 if step is None else 1 << step
            return
        if source is None:
            if self.phase in ('starting', 'countdown', 'running'): self.stop('Volante sem sinal. Corrida encerrada.')
            self.input = dict(ZERO)
            return
        start, finish, lap = (self.pressed(source, b) for b in ('start', 'finish', 'lap'))
        self.input = {k: source[k] for k in ZERO}
        throttle, brake, steering = source['throttle'], source['brake'], source['steering']
        if self.phase in ('idle', 'finished', 'starting'):
            if self.blocked:
                self.armed = False  # releasing the throttle is needed after the block, too
                return
            if start:
                self.start_countdown(now)
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
        elif lap:
            self.add_lap(now)
            if self.phase != 'running': return  # last lap of a time trial
        if throttle > MOVING_THROTTLE: self.last_move = now
        elif now - self.last_move >= INACTIVITY:
            # The race time ends when the car last moved, not 15 s later.
            self.stop('Corrida finalizada por inatividade.', end=self.last_move); return
        # Hysteresis matches the existing relay controller (~15% / 8%).
        if steering >= STEER_ON: self.turn = 4
        elif steering <= -STEER_ON: self.turn = 8
        elif (self.turn == 4 and steering <= STEER_OFF) or (self.turn == 8 and steering >= -STEER_OFF): self.turn = 0
        if throttle >= PEDAL_ON: self.drive |= 1
        elif throttle <= PEDAL_OFF: self.drive &= ~1
        if brake >= PEDAL_ON: self.drive |= 2
        elif brake <= PEDAL_OFF: self.drive &= ~2
        self.mask = (0 if self.drive == 3 else self.drive) | self.turn
