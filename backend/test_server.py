import asyncio
import unittest
from aiohttp import WSServerHandshakeError
from aiohttp.test_utils import TestClient, TestServer
from backend.server import Server, create_app
from backend.test_control import FakeSerial


class ServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.server = Server(serial_factory=lambda *a, **k: FakeSerial(), ports=lambda: ['COM7'], xinput=False)
        self.server.fleet.auto_test = False  # the self-test has its own test below
        self.client = TestClient(TestServer(create_app(self.server)))
        await self.client.start_server()

    async def asyncTearDown(self): await self.client.close()

    @property
    def controller(self): return self.server.fleet.slots[0].controller

    def link(self): return self.server.fleet.boards['COM7'].link

    async def ws(self, query='', origin='http://127.0.0.1:8080'):
        return await self.client.ws_connect('/ws/telemetry' + query, headers={'Origin': origin})

    async def until(self, ws, check):
        async with asyncio.timeout(4):
            while True:
                data = (await ws.receive_json())['data']
                if check(data): return data

    async def test_owner_observer_pulse_and_handover(self):
        owner = await self.ws()
        await self.until(owner, lambda d: d['connected'] and d['controlAvailable'])
        observer = await self.ws()
        state = await observer.receive_json(); self.assertFalse(state['data']['controlAvailable'])
        await observer.send_json(dict(type='relay', data=dict(relay=1)))
        await asyncio.sleep(.08); self.assertEqual(self.controller.mask, 0)
        await owner.send_json(dict(type='relay', data=dict(relay=3)))
        await self.until(owner, lambda d: d['relayMask'] == 4)
        await self.until(owner, lambda d: d['relayMask'] == 0)
        await owner.close()
        await self.until(observer, lambda d: d['controlAvailable'])
        self.assertEqual(self.controller.phase, 'idle')
        await observer.close()

    async def test_each_screen_sees_its_color_and_the_whole_fleet(self):
        azul = await self.ws('?vaga=1')
        data = await self.until(azul, lambda d: d['connected'])
        self.assertEqual(data['slot'], dict(number=1, name='AZUL ELÉTRICO', color=1))
        self.assertEqual([s['name'] for s in data['fleet']['slots']], ['AZUL ELÉTRICO', 'LARANJA', 'VERMELHO', 'ROXO'])
        roxo = await self.ws('?vaga=4')
        data = await self.until(roxo, lambda d: d['slot']['number'] == 4)
        self.assertFalse(data['connected'])  # no car in the 4th color yet
        self.assertIn('Sem carrinho na vaga 04 ROXO', data['status'])
        await azul.close(); await roxo.close()

    async def test_operator_panel_starts_and_stops_everyone(self):
        from backend.test_control import pad
        self.server.fleet.pads = [pad(), None, None, None]  # wheel of slot 1 (a car without wheel cannot race)
        panel = await self.ws('?painel=1')
        await self.until(panel, lambda d: d['fleet']['slots'][0]['connected'])
        await panel.send_json(dict(type='mode', data=dict(laps=3)))
        await panel.send_json(dict(type='startAll', data={}))
        data = await self.until(panel, lambda d: d['fleet']['slots'][0]['phase'] == 'countdown')
        self.assertEqual(data['fleet']['slots'][0]['raceMode'], 3)
        self.assertEqual(data['fleet']['slots'][1]['phase'], 'idle')  # no car there: not started
        await panel.send_json(dict(type='stopAll', data={}))
        await self.until(panel, lambda d: d['fleet']['slots'][0]['phase'] == 'idle')
        await panel.send_json(dict(type='driver', data=dict(slot=1, name='Ana')))
        await self.until(panel, lambda d: d['fleet']['slots'][0]['driver'] == 'Ana')
        await panel.close()

    async def test_tablet_on_the_event_network_is_accepted(self):
        ws = await self.ws('?vaga=2', origin='http://192.168.0.20:8080')
        data = await self.until(ws, lambda d: True)
        self.assertEqual(data['slot']['name'], 'LARANJA')
        await ws.close()

    async def test_ranking_endpoint_and_driver_name(self):
        ws = await self.ws(); await self.until(ws, lambda d: d['connected'])
        await ws.send_json(dict(type='driver', data=dict(name='Rodrigo')))
        await self.until(ws, lambda d: d['driver'] == 'Rodrigo')
        self.controller.finished_race = dict(duration_ms=12000, laps_ms=[5000, 4000], reason='B')
        result = (await self.until(ws, lambda d: d['lastResult']))['lastResult']
        self.assertEqual((result['driver'], result['bestLapMs'], result['position'], result['slot']), ('Rodrigo', 4000, 1, 1))
        response = await self.client.get('/api/ranking', headers={'Origin': 'http://127.0.0.1:5173'})
        data = await response.json()
        self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:5173')
        self.assertEqual(data['bestLaps'][0]['lapMs'], 4000); self.assertEqual(data['bestLaps'][0]['slot'], 1)
        await ws.close()

    async def test_self_test_runs_on_connect_and_reports_each_relay(self):
        for board in self.server.fleet.boards.values(): board.tested = False
        self.server.fleet.auto_test = True
        ws = await self.ws()
        await self.until(ws, lambda d: d['selfTest']['running'])
        report = (await self.until(ws, lambda d: not d['selfTest']['running'] and d['selfTest']['results'][0] is not None))['selfTest']
        self.assertEqual(report['results'], [True, True, True, True]); self.assertFalse(report['interrupted'])
        self.assertEqual(self.controller.mask, 0)
        self.link().ignore = {2}
        await ws.send_json(dict(type='selftest', data={}))
        await self.until(ws, lambda d: d['selfTest']['running'])
        report = (await self.until(ws, lambda d: not d['selfTest']['running']))['selfTest']
        self.assertEqual(report['results'], [True, False, True, True])
        await ws.send_json(dict(type='autoTest', data=dict(enabled=False)))
        await self.until(ws, lambda d: d['selfTest']['auto'] is False)
        self.assertEqual(self.server.history.setting('auto_test'), '0')
        await ws.close()

    async def test_foreign_web_page_cannot_open_controller(self):
        with self.assertRaises(WSServerHandshakeError):
            await self.ws(origin='https://example.com')

    async def test_explicit_claim_stops_old_owner_and_does_not_resume(self):
        first = await self.ws(); await self.until(first, lambda d: d['connected'])
        second = await self.ws()
        await first.send_json(dict(type='relay', data=dict(relay=1)))
        await self.until(first, lambda d: d['relayMask'] == 1)
        await second.send_json(dict(type='claim', data={}))
        await self.until(second, lambda d: d['controlAvailable'] and d['relayMask'] == 0)
        await first.send_json(dict(type='relay', data=dict(relay=2)))
        await asyncio.sleep(.08)
        self.assertEqual(self.controller.mask, 0)
        await first.close(); await second.close()

    async def test_serial_disconnect_is_reported_and_commands_do_not_resume(self):
        ws = await self.ws(); await self.until(ws, lambda d: d['connected'])
        link = self.link(); link.respond = False; link.buffer = b''
        await self.until(ws, lambda d: not d['connected'] and d['relayMask'] is None)
        self.assertFalse(self.controller.enabled)
        self.assertEqual(self.controller.mask, 0)
        await ws.close()


class CockpitCountTests(unittest.TestCase):
    def test_each_cockpit_screen_gets_its_slot_beyond_four(self):
        server = Server(serial_factory=lambda *a, **k: FakeSerial(), ports=lambda: [], xinput=False, cockpits=8)
        data = server.telemetry(6)
        self.assertEqual(data['slot']['number'], 6)
        self.assertEqual(len(data['fleet']['slots']), 8)

class LapAlertTests(unittest.IsolatedAsyncioTestCase):
    async def test_laps_are_saved_at_once_with_personal_best_and_event_record(self):
        server = Server(serial_factory=lambda *a, **k: FakeSerial(), ports=lambda: [], xinput=False)
        server.open_event('Fortaleza')
        slot = server.fleet.slots[0]
        c = slot.controller
        c.phase, c.race_id, c.race_start, c.laps = 'running', 1, 0.0, [35.2]
        await server.follow_laps(slot)
        self.assertEqual(server.history.best_lap()['lapMs'], 35200)  # saved as the lap closed
        self.assertEqual([a['kind'] for a in server.alerts if a['kind'] == 'record'], ['record'])  # first lap of the event
        records = len([a for a in server.alerts if a['kind'] == 'record'])
        c.laps.append(35.2 + 36.0); await server.follow_laps(slot)  # slower: nothing new
        self.assertEqual(len([a for a in server.alerts if a['kind'] == 'record']), records)
        self.assertFalse(slot.last_lap['personalBest'] or slot.last_lap['record'])
        c.laps.append(35.2 + 36.0 + 32.814); await server.follow_laps(slot)  # faster than all
        self.assertTrue(slot.last_lap['personalBest'] and slot.last_lap['record'])
        newest_record = next(a for a in server.alerts if a['kind'] == 'record')
        self.assertEqual(newest_record['lapMs'], 32814)
        summary = server.fleet_summary(0)
        self.assertEqual(summary['record']['lapMs'], 32814)
        self.assertEqual(summary['slots'][0]['lastLap']['number'], 3)
        self.assertIn('novo recorde do evento', server.fleet.events[0]['text'])
        # The race ends: the same row is closed, not a second one.
        c.finished_race = dict(duration_ms=110000, laps_ms=[35200, 36000, 32814], reason='B', target_laps=0, completed=False)
        await server.save_race(slot)
        rows = server.history.ranking()['recent']
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['laps'], rows[0]['durationMs']), (3, 110000))


class EventAndTopTests(unittest.IsolatedAsyncioTestCase):
    async def lap(self, server, slot, race_id, seconds):
        c = slot.controller
        c.phase, c.race_id, c.race_start, c.laps = 'running', race_id, 0.0, [seconds]
        await server.follow_laps(slot)

    async def test_practice_makes_no_record_and_the_top_n_alerts_follow_each_lap(self):
        server = Server(serial_factory=lambda *a, **k: FakeSerial(), ports=lambda: [], xinput=False)
        server.history.set_setting('top_n', '2')
        a, b = server.fleet.slots[0], server.fleet.slots[1]
        await self.lap(server, a, 1, 30.0)  # practice
        self.assertEqual(server.alerts, [])
        self.assertIsNone(server.fleet_summary(0)['record'])
        server.open_event('Fortaleza')
        self.assertEqual(server.fleet_summary(0)['event']['name'], 'Fortaleza')
        await self.lap(server, a, 2, 34.0)  # 1st session of the event: record and TOP 2
        kinds = [x['kind'] for x in server.alerts]
        self.assertIn('record', kinds); self.assertIn('top', kinds)
        await self.lap(server, b, 3, 33.0)  # 2nd session: TOP 2 full -> cut time appears
        self.assertEqual(server.alerts[0]['kind'], 'cut')
        self.assertEqual(server.alerts[0]['lapMs'], 34000)
        await self.lap(server, a, 4, 32.5)  # 3rd session enters 1st; the 34.0 one is pushed out
        kinds = [x['kind'] for x in server.alerts[:4]]
        self.assertIn('out', kinds)
        out = next(x for x in server.alerts if x['kind'] == 'out')
        self.assertEqual(out['position'], 3)
        summary = server.fleet_summary(0)
        self.assertEqual(summary['ranking']['cutMs'], 33000)
        self.assertEqual(summary['ranking']['total'], 3)
        self.assertEqual(summary['slots'][0]['session']['position'], 1)
        self.assertTrue(summary['slots'][0]['session']['inTop'])
        server.close_event()
        self.assertIsNone(server.fleet_summary(0)['event'])
        self.assertIsNone(server.fleet_summary(0)['record'])



class ArenaTests(unittest.IsolatedAsyncioTestCase):
    """The real arena and the SIMULAÇÃO arena are never mixed; the screens are the same."""

    async def asyncSetUp(self):
        from backend.server import simulation_server
        self.real = Server(serial_factory=lambda *a, **k: FakeSerial(), ports=lambda: ['COM7'], xinput=False)
        self.sim = simulation_server(db=':memory:')
        self.client = TestClient(TestServer(create_app(self.real, self.sim)))
        await self.client.start_server()

    async def asyncTearDown(self): await self.client.close()

    async def fleet(self, query):
        ws = await self.client.ws_connect('/ws/telemetry?painel=1' + query, headers={'Origin': 'http://127.0.0.1:8080'})
        async with asyncio.timeout(6):
            while True:
                data = (await ws.receive_json())['data']
                if data['fleet']['slots'][0]['connected']:
                    await ws.close()
                    return data['fleet']

    async def test_simulation_is_its_own_arena_ready_for_testing(self):
        sim = await self.fleet('&simulacao=1')
        self.assertEqual((len(sim['slots']), sim['available'], sim['capacity']), (16, 16, 16))  # every grid full
        self.assertEqual(sim['slots'][0]['port'], 'SIM1')
        self.assertEqual(sim['slots'][10]['blockReason'], 'battery')  # one empty battery to see the warning
        self.assertEqual(sim['slots'][0]['acceptance']['passed'], 0)  # acceptance to be tested
        self.assertEqual(sim['slots'][0]['raceMode'], 5)  # a full 5-lap race
        real = await self.fleet('')
        self.assertEqual(real['slots'][0]['port'], 'COM7')
        self.assertFalse(any((s['port'] or '').startswith('SIM') for s in real['slots']))
        self.assertFalse(any(b['port'].startswith('SIM') for b in real['spareBoards']))
        # Commands go to their own arena only.
        ws = await self.client.ws_connect('/ws/telemetry?painel=1&simulacao=1', headers={'Origin': 'http://127.0.0.1:8080'})
        await ws.send_json(dict(type='eventOpen', data=dict(name='Treino simulado')))
        async with asyncio.timeout(3):
            while self.sim.event is None: await asyncio.sleep(.02)
        await ws.close()
        self.assertIsNone(self.real.event)
        ranking = await (await self.client.get('/api/ranking?simulacao=1')).json()
        self.assertEqual(ranking['event']['name'], 'Treino simulado')
        self.assertIsNone((await (await self.client.get('/api/ranking')).json())['event'])

    async def test_no_simulation_arena_means_no_simulated_data(self):
        client = TestClient(TestServer(create_app(self.real)))
        await client.start_server()
        try:
            self.assertEqual((await client.get('/api/ranking?simulacao=1')).status, 404)
            self.assertEqual((await client.post('/api/simular?porta=SIM2&acao=desplugar')).status, 404)
        finally:
            await client.close()

    def test_virtual_drivers_move_every_tick(self):
        pads = []
        for now in (10.0, 10.5, 11.0):
            self.sim.read_pads()
            self.sim.fleet.pads = self.sim.autopilot.fill(self.sim.fleet.pads, now, self.sim.fleet)
            pads.append(self.sim.fleet.pads[0]['steering'])
        self.assertEqual(len(set(pads)), 3)  # not frozen after the first tick

    def test_simulation_starts_the_next_race_by_itself_after_the_champion(self):
        from backend.server import SIM_NEXT_RACE
        f = self.sim.fleet
        f.scan(0)
        t = 0.0
        while t < 3:  # boards connected and their self-test done, virtual drivers on the wheels
            t += .05
            self.sim.read_pads(); f.pads = self.sim.autopilot.fill(f.pads, t, f); f.step(t)
        f.finish_order = [dict(slot=7, color=7, durationMs=46000, position=1)]  # a race just ended
        self.sim.next_simulated_race(t)
        self.assertEqual(f.finish_order, [dict(slot=7, color=7, durationMs=46000, position=1)])  # champion on screen
        self.sim.next_simulated_race(t + SIM_NEXT_RACE + .1)
        self.assertEqual(f.finish_order, [])  # a new race
        self.assertTrue(any(s.controller.phase == 'countdown' for s in f.slots))
        self.assertEqual(f.battery_state(f.slots[0])['percent'], 100)
        self.real.fleet.finish_order = [dict(slot=1, color=1, durationMs=1, position=1)]
        self.real.next_simulated_race(1000)  # the real cars never start by themselves
        self.assertEqual(len(self.real.fleet.finish_order), 1)

    async def test_public_demo_is_simulation_only_and_accepts_the_published_panel(self):
        from backend.server import simulation_server
        demo = simulation_server(db=':memory:')
        demo.public_origins = {'https://esp32-car-three.vercel.app'}
        client = TestClient(TestServer(create_app(demo, demo)))
        await client.start_server()
        try:
            ws = await client.ws_connect('/ws/telemetry?painel=1', headers={'Origin': 'https://esp32-car-three.vercel.app'})
            data = (await ws.receive_json())['data']
            self.assertTrue(data['controlAvailable'])  # the demo panel runs the virtual race
            self.assertEqual(len(data['fleet']['slots']), 16)
            await ws.close()
            with self.assertRaises(WSServerHandshakeError):
                await client.ws_connect('/ws/telemetry', headers={'Origin': 'https://evil.example'})
        finally:
            await client.close()
        self.assertIsNone(self.real.public_origins)  # the event server never answers the internet

    def test_simulation_restarts_ready(self):
        from backend.server import seed_simulation
        from backend.history import History
        h = History()
        h.set_setting('slot1_battery_used', 1800)
        h.set_setting('available_slots', 2)
        seed_simulation(h)
        self.assertEqual(h.setting('available_slots'), '16')
        self.assertEqual(float(h.setting('slot1_battery_used')), 120.0)
