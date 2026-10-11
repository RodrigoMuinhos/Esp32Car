"""Technical acceptance of one car (Central Técnica): pure, time injectable.

Seven checks, run in this order by INICIAR ACEITAÇÃO (or one at a time):
communication with the board, wheel, pedals, relays K1-K4 (one at a time,
after the operator confirms the area is clear), emergency stop (relays must be
confirmed off in time), camera and audio (both measured on the operator panel
and reported back). Audio is auxiliary; the other six are critical: the car is
only released when all of them passed. Each check is idle, testing, passed or
failed, nothing else.

While an event is open the acceptance is required before a car can start. It
stays valid during the event until something invalidates it (lost board,
wheel or car swapped, board restarted, emergency stop, a new event).

The Fleet feeds a context per tick (board, wheel reading, controller) and
applies what this module asks for (relay mask, stop). Nothing here touches
hardware.
"""
from datetime import datetime

ITEMS = ('communication', 'steering', 'pedals', 'actuators', 'emergency', 'camera', 'audio')
LABELS = dict(communication='Comunicação com a placa', steering='Volante', pedals='Pedais',
              actuators='Relés / atuadores', emergency='Parada de emergência', camera='Câmera', audio='Áudio')
CRITICAL = ('communication', 'steering', 'pedals', 'actuators', 'emergency', 'camera')
STATUSES = ('idle', 'testing', 'passed', 'failed')
# Why a new acceptance is needed (the last one that happened is shown).
TRIGGERS = ('EVENT_START', 'MANUAL', 'COMMUNICATION_RESET', 'CONTROLLER_CHANGED', 'ESP32_RESTARTED',
            'VEHICLE_CHANGED', 'TECHNICAL_INTERVENTION')
TRIGGER_TEXT = dict(EVENT_START='evento aberto', MANUAL='novo aceite pedido pelo operador',
                    COMMUNICATION_RESET='placa sem comunicação por muito tempo',
                    CONTROLLER_CHANGED='volante trocado', ESP32_RESTARTED='placa reiniciou',
                    VEHICLE_CHANGED='carrinho trocado', TECHNICAL_INTERVENTION='parada de emergência / intervenção técnica')
# Thresholds (seconds unless noted).
COMM_WINDOW = 1.0  # the board must stay alive and confirming for this long
COMM_TIMEOUT = 5.0
COMM_MAX_GAP = .3  # longest wait between two confirmations
COMM_MAX_CONFIRM_MS = 100  # command sent -> ESTADO with the same mask
INPUT_TIMEOUT = 30.0  # wheel and pedal moves by the operator
STEERING_FULL, PEDAL_FULL = 60, 80  # same as the setup wizard
AREA_TIMEOUT = 60.0
RELAY_ON, RELAY_GAP = .5, .5  # K1 -> K2 -> K3 -> K4, one at a time
ARM_TIMEOUT = 2.0  # emergency test: K3 (steering only) must be confirmed on
STOP_LIMIT = .3  # ... and confirmed off this fast after the stop
EMERGENCY_RELAY = 4  # K3: turns the wheels, does not drive the car
REPORT_TIMEOUT = 30.0  # camera / audio answers from the panel
CAMERA_MIN_FPS, CAMERA_GOOD_FPS = 15, 24


def stamp():
    return datetime.now().astimezone().isoformat(timespec='seconds')


class Acceptance:
    def __init__(self):
        self.items = {k: dict(status='idle', message='Aguardando.', startedAt=None, finishedAt=None) for k in ITEMS}
        self.queue = []  # checks still to run, the first is the one running
        self.full = False  # running the whole acceptance (not a single check)
        self.stage = None  # step inside the running check
        self.since = 0.0  # when the stage started
        self.data = {}
        self.area_ok = False  # operator confirmed the area is clear (for this run)
        self.trigger = None  # why a new acceptance is needed, or None
        self.last_run = None  # dict(result, at) of the last full run
        self.finished = []  # full runs that ended, for the history (the server takes them)
        self.mask = 0  # relays asked for by the running check
        self.want_stop = False  # the emergency check asks the fleet to stop the car now

    # ---------- state ----------
    @property
    def running(self):
        return bool(self.queue)

    @property
    def current(self):
        return self.queue[0] if self.queue else None

    def released(self):
        return not self.running and all(self.items[k]['status'] == 'passed' for k in CRITICAL)

    def waiting(self):
        """What the running check waits for from the operator panel: 'area', 'camera', 'audio' or None."""
        if self.stage == 'area': return 'area'
        if self.current in ('camera', 'audio') and self.stage == 'report': return self.current
        return None

    def invalidate(self, trigger, now=None):
        """Something changed: the checks must be done again (a run in progress is cancelled)."""
        if trigger not in TRIGGERS: return False
        had = any(i['status'] != 'idle' for i in self.items.values()) or self.running
        self.cancel('Aceite invalidado: ' + TRIGGER_TEXT[trigger] + '.')
        for item in self.items.values(): item.update(status='idle', message='Aguardando.', startedAt=None, finishedAt=None)
        self.trigger = trigger
        return had

    # ---------- running ----------
    def start(self, items=None, now=0.0):
        """Full acceptance (items=None) or some checks; False if one is already running."""
        if self.running: return False
        items = list(ITEMS) if items is None else [i for i in ITEMS if i in items]
        if not items: return False
        self.full = len(items) == len(ITEMS)
        if self.full:
            for item in self.items.values(): item.update(status='idle', message='Aguardando.', startedAt=None, finishedAt=None)
        self.queue = items
        self.area_ok = False
        self.begin(now)
        return True

    def begin(self, now):
        item = self.items[self.current]
        item.update(status='testing', startedAt=stamp(), finishedAt=None, message='Testando…')
        self.stage, self.since, self.data, self.mask, self.want_stop = 'start', now, {}, 0, False

    def finish(self, ok, message, now):
        name = self.queue.pop(0)
        self.items[name].update(status='passed' if ok else 'failed', message=message, finishedAt=stamp())
        self.mask, self.want_stop, self.stage = 0, False, None
        if self.queue:
            self.begin(now)
            return
        if self.full:
            passed = self.released()
            self.last_run = dict(result='passed' if passed else 'failed', at=stamp())
            if passed: self.trigger = None
            self.finished.append(dict(result=self.last_run['result'], trigger=self.trigger,
                                      items={k: dict(self.items[k]) for k in ITEMS}))
        elif self.released():
            self.trigger = None

    def cancel(self, message='Aceite cancelado.'):
        if not self.running: return
        for name in self.queue: self.items[name].update(status='failed' if name == self.current else 'idle',
                                                         message=message if name == self.current else 'Aguardando.')
        self.queue, self.stage, self.mask, self.want_stop, self.full = [], None, 0, False, False

    def confirm_area(self, now):
        if self.stage != 'area': return False
        self.area_ok = True; self.stage = 'start'; self.since = now
        return True

    def report(self, name, data, now):
        """Camera or audio result measured on the operator panel."""
        if self.current != name or self.stage != 'report' or not isinstance(data, dict): return False
        if name == 'audio':
            heard = data.get('ok') is True
            self.finish(heard, 'Operador ouviu o som de teste.' if heard else 'Operador não ouviu o som de teste.', now)
            return True
        fps, width, height = data.get('fps'), data.get('width'), data.get('height')
        if data.get('ok') is not True or type(fps) not in (int, float) or fps <= 0:
            self.finish(False, str(data.get('message') or 'Sem imagem da câmera.')[:80], now)
            return True
        size = f'{int(width)}×{int(height)} · ' if type(width) in (int, float) and type(height) in (int, float) else ''
        if fps < CAMERA_MIN_FPS: self.finish(False, f'{size}{fps:.0f} FPS: abaixo do mínimo ({CAMERA_MIN_FPS}).', now)
        elif fps < CAMERA_GOOD_FPS: self.finish(True, f'{size}{fps:.0f} FPS · ATENÇÃO: abaixo de {CAMERA_GOOD_FPS}.', now)
        else: self.finish(True, f'{size}{fps:.0f} FPS · latência não medida.', now)
        return True

    def step(self, now, ctx):
        """One tick. ctx: alive, port, firmware, confirmMs, ackGap, confirmed (mask or None),
        pad (wheel reading or None), phase (controller), testing (the controller follows
        self.mask), simulatedCamera."""
        if not self.running: return
        name, item = self.current, self.items[self.current]
        elapsed = now - self.since
        if name == 'communication':
            if not ctx['alive']:
                self.data['since'] = None
                if elapsed >= COMM_TIMEOUT: self.finish(False, 'A placa não responde.', now)
                return
            self.data.setdefault('since', now)
            if self.data['since'] is None: self.data['since'] = now
            gap, confirm = ctx.get('ackGap'), ctx.get('confirmMs')
            slow = (gap is not None and gap > COMM_MAX_GAP) or (confirm is not None and confirm > COMM_MAX_CONFIRM_MS)
            if slow and elapsed >= COMM_TIMEOUT:
                self.finish(False, f'Confirmação lenta ({confirm or "—"} ms).', now); return
            if not slow and now - self.data['since'] >= COMM_WINDOW:
                fw = f' · firmware v{ctx["firmware"]}' if ctx.get('firmware') else ''
                ms = f' · confirmação {confirm} ms' if confirm is not None else ''
                self.finish(True, f'{ctx.get("port") or "—"}{fw}{ms}', now)
            else:
                item['message'] = 'Verificando a comunicação…'
        elif name in ('steering', 'pedals'):
            pad = ctx.get('pad')
            seen = self.data.setdefault('seen', dict(a=False, b=False))
            if pad:
                if name == 'steering':
                    seen['a'] |= pad['steering'] <= -STEERING_FULL; seen['b'] |= pad['steering'] >= STEERING_FULL
                else:
                    seen['a'] |= pad['throttle'] >= PEDAL_FULL; seen['b'] |= pad['brake'] >= PEDAL_FULL
            if all(seen.values()):
                self.finish(True, 'Esquerda e direita confirmadas.' if name == 'steering' else 'Acelerador e freio no fundo confirmados.', now)
            elif elapsed >= INPUT_TIMEOUT:
                self.finish(False, 'Volante não detectado.' if not pad else
                            'Faltou ' + ' e '.join(w for w, ok in zip(
                                ('esquerda', 'direita') if name == 'steering' else ('acelerador', 'freio'),
                                (seen['a'], seen['b'])) if not ok) + '.', now)
            else:
                item['message'] = (('Gire o volante todo à esquerda e todo à direita.' if name == 'steering'
                                    else 'Pise o acelerador e o freio até o fundo.') if pad else 'Aguardando o volante…')
        elif name in ('actuators', 'emergency'):
            self.relays(name, item, now, elapsed, ctx)
        else:  # camera, audio: measured on the panel
            if self.stage == 'start':
                self.stage = 'report'; self.since = now
                if name == 'camera' and ctx.get('simulatedCamera'):
                    self.finish(True, 'Câmera simulada (servidor de teste).', now); return
                item['message'] = ('Clique em TESTAR IMAGEM com a câmera ligada.' if name == 'camera'
                                   else 'Clique em TESTAR SOM e responda se ouviu.')
            elif elapsed >= REPORT_TIMEOUT:
                self.finish(False, 'Sem imagem da câmera.' if name == 'camera' else 'Sem resposta do operador.', now)

    def relays(self, name, item, now, elapsed, ctx):
        if self.stage == 'start' and not self.area_ok:
            self.stage, self.since = 'area', now
            item['message'] = 'Confirme ÁREA LIVRE: o carrinho pode se mover.'
            return
        if self.stage == 'area':
            if elapsed >= AREA_TIMEOUT: self.finish(False, 'Área livre não confirmada.', now)
            return
        if not ctx['alive']:
            self.finish(False, 'A placa não responde.', now); return
        if self.stage == 'start':
            self.stage, self.since = 'run', now  # the fleet puts the controller in test mode
            self.data = dict(ok=[False] * 4)
            item['message'] = 'K1 → K2 → K3 → K4…' if name == 'actuators' else 'Ligando K3 (direção)…'
            return
        if self.stage == 'run' and not ctx['testing']:
            self.finish(False, 'Teste interrompido (parada ou volante).', now); return
        if name == 'actuators':
            step = int(elapsed // (RELAY_ON + RELAY_GAP))
            if step >= 4:
                ok = self.data['ok']
                self.finish(all(ok), '4/4 confirmados pela placa.' if all(ok) else
                            ', '.join(f'K{i + 1}' for i, v in enumerate(ok) if not v) + ' sem confirmação.', now)
                return
            on = elapsed - step * (RELAY_ON + RELAY_GAP) < RELAY_ON
            self.mask = 1 << step if on else 0
            if on and ctx.get('confirmed') == 1 << step: self.data['ok'][step] = True
            item['message'] = f'Testando K{step + 1}…'
            return
        # Emergency: K3 on, then stop; the board must confirm everything off in time.
        if self.stage == 'run':
            self.mask = EMERGENCY_RELAY
            if ctx.get('confirmed') == EMERGENCY_RELAY:
                self.stage, self.since, self.want_stop, self.mask = 'stopping', now, True, 0
                item['message'] = 'Parada acionada, aguardando confirmação…'
            elif elapsed >= ARM_TIMEOUT:
                self.finish(False, 'K3 não confirmou para o teste.', now)
        elif self.stage == 'stopping':
            self.want_stop = False
            if ctx.get('confirmed') == 0:
                ms = round(elapsed * 1000)
                self.finish(elapsed <= STOP_LIMIT, f'Relés desligados em {ms} ms.' if elapsed <= STOP_LIMIT
                            else f'Desligou em {ms} ms (limite {round(STOP_LIMIT * 1000)} ms).', now)
            elif elapsed >= 1.0:
                self.finish(False, 'A placa não confirmou os relés desligados.', now)

    def summary(self, required):
        items = [dict(id=k, label=LABELS[k], critical=k in CRITICAL, **self.items[k]) for k in ITEMS]
        return dict(items=items, running=self.running, current=self.current, waiting=self.waiting(),
                    released=self.released(), required=required, trigger=self.trigger,
                    triggerText=TRIGGER_TEXT.get(self.trigger), lastRun=self.last_run,
                    passed=sum(i['status'] == 'passed' for i in items), total=len(items),
                    failed=[i['id'] for i in items if i['status'] == 'failed'],
                    criticalFailed=[i['id'] for i in items if i['status'] == 'failed' and i['critical']])
