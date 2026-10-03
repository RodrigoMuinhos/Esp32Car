import asyncio
import unittest
from aiohttp import WSServerHandshakeError
from aiohttp.test_utils import TestClient, TestServer
from backend.server import Bridge, create_app
from backend.test_control import FakeSerial


class ServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.bridge = Bridge('COM7', serial_factory=FakeSerial)
        self.bridge.xinput = None
        self.client = TestClient(TestServer(create_app(self.bridge)))
        await self.client.start_server()

    async def asyncTearDown(self): await self.client.close()

    async def ws(self):
        return await self.client.ws_connect('/ws/telemetry', headers={'Origin': 'http://127.0.0.1:8080'})

    async def until(self, ws, check):
        async with asyncio.timeout(3):
            while True:
                data = (await ws.receive_json())['data']
                if check(data): return data

    async def test_owner_observer_pulse_and_handover(self):
        owner = await self.ws()
        await self.until(owner, lambda d: d['connected'] and d['controlAvailable'])
        observer = await self.ws()
        state = await observer.receive_json(); self.assertFalse(state['data']['controlAvailable'])
        await observer.send_json(dict(type='relay', data=dict(relay=1)))
        await asyncio.sleep(.08); self.assertEqual(self.bridge.controller.mask, 0)
        await owner.send_json(dict(type='relay', data=dict(relay=3)))
        await self.until(owner, lambda d: d['relayMask'] == 4)
        await self.until(owner, lambda d: d['relayMask'] == 0)
        await owner.close()
        await self.until(observer, lambda d: d['controlAvailable'])
        self.assertEqual(self.bridge.controller.phase, 'idle')
        await observer.close()

    async def test_foreign_web_page_cannot_open_controller(self):
        with self.assertRaises(WSServerHandshakeError):
            await self.client.ws_connect('/ws/telemetry', headers={'Origin': 'https://example.com'})

    async def test_explicit_claim_stops_old_owner_and_does_not_resume(self):
        first = await self.ws(); await self.until(first, lambda d: d['connected'])
        second = await self.ws()
        await first.send_json(dict(type='relay', data=dict(relay=1)))
        await self.until(first, lambda d: d['relayMask'] == 1)
        await second.send_json(dict(type='claim', data={}))
        await self.until(second, lambda d: d['controlAvailable'] and d['relayMask'] == 0)
        await first.send_json(dict(type='relay', data=dict(relay=2)))
        await asyncio.sleep(.08)
        self.assertEqual(self.bridge.controller.mask, 0)
        await first.close(); await second.close()

    async def test_serial_disconnect_is_reported_and_commands_do_not_resume(self):
        ws = await self.ws(); await self.until(ws, lambda d: d['connected'])
        self.bridge.port.respond = False; self.bridge.port.buffer = b''
        await self.until(ws, lambda d: not d['connected'] and d['relayMask'] is None)
        self.assertFalse(self.bridge.controller.enabled)
        self.assertEqual(self.bridge.controller.mask, 0)
        await ws.close()
