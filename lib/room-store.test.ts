import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  blankRoom,
  lockedRoomStep,
  roomCommand,
  roomFromJson,
  roomToJson,
  roomView,
} from './room';
import { GET } from '../app/api/room/route';
import {
  REDIS_ENV_PAIRS,
  REDIS_MISSING_ERROR,
  ROOM_KEY,
  createMemoryKv,
  redisCredentials,
  setRoomKvForTests,
  storeMode,
  withLock,
} from './room-store';

const REDIS_ENV_NAMES = REDIS_ENV_PAIRS.flat();

const savedEnv = new Map<string, string | undefined>(
  ['VERCEL', ...REDIS_ENV_NAMES].map((name) => [name, process.env[name]]),
);

function restoreEnv() {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function clearRedisEnv() {
  for (const name of REDIS_ENV_NAMES) delete process.env[name];
}

describe('room store', { concurrency: 1 }, () => {
  before(() => {
    clearRedisEnv();
    delete process.env.VERCEL;
    setRoomKvForTests(null);
  });

  after(() => {
    setRoomKvForTests(null);
    restoreEnv();
  });

  test('local dev without redis uses memory and keeps the seat', async () => {
    assert.equal(storeMode(), 'memory');
    const kv = createMemoryKv();
    setRoomKvForTests(kv);
    const joined = await roomCommand({ op: 'join', team: 'you', name: 'Анна' });
    assert.equal(joined.error, undefined);
    assert.ok(joined.playerId);
    const loaded = roomFromJson((await kv.get(ROOM_KEY))!);
    assert.equal(loaded.seats.length, 1);
    assert.equal(loaded.seats[0].id, joined.playerId);
    assert.equal(loaded.seats[0].name, 'Анна');
    assert.equal(loaded.seats[0].team, 'you');
    const again = await roomView(joined.playerId!);
    assert.equal(again.you?.team, 'you');
    assert.equal(again.seats[0].name, 'Анна');
  });

  test('two locked polls advance the clock once', async () => {
    const kv = createMemoryKv();
    const now = 1_700_000_000_000;
    const room = blankRoom(now);
    room.started = true;
    room.paused = false;
    room.clock = now - 200;
    room.seats = [
      { id: 'seat-1', name: 'Анна', team: 'you', seen: now, ready: false },
    ];
    await kv.set(ROOM_KEY, roomToJson(room));
    const [left, right] = await Promise.all([
      lockedRoomStep(kv, 'seat-1', now),
      lockedRoomStep(kv, 'seat-1', now),
    ]);
    assert.equal(left.seats[0].id, 'seat-1');
    assert.equal(right.seats[0].id, 'seat-1');
    assert.equal(left.clock, now);
    assert.equal(right.clock, now);
    assert.ok(Math.abs(left.game.elapsed - 0.2) < 1e-9);
    assert.ok(Math.abs(right.game.elapsed - 0.2) < 1e-9);
    const saved = roomFromJson((await kv.get(ROOM_KEY))!);
    assert.equal(saved.seats[0].name, 'Анна');
    assert.equal(saved.seats[0].seen, now);
    assert.ok(Math.abs(saved.game.elapsed - 0.2) < 1e-9);
  });

  test('a poll that misses the lock returns the snapshot without ticking', async () => {
    const kv = createMemoryKv();
    setRoomKvForTests(kv);
    const now = Date.now();
    const room = blankRoom(now - 5000);
    room.started = true;
    room.paused = false;
    room.clock = now - 5000;
    room.game = { ...room.game, elapsed: 1.25 };
    room.seats = [
      { id: 'seat-1', name: 'Анна', team: 'you', seen: now, ready: false },
    ];
    await kv.set(ROOM_KEY, roomToJson(room));

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locking = withLock(kv, () => gate);

    const started = Date.now();
    const view = await roomView('seat-1');
    const waited = Date.now() - started;
    assert.ok(waited < 100, `lock miss waited ${waited}ms`);
    assert.ok(Math.abs((view.game?.elapsed ?? -1) - 1.25) < 1e-9);
    assert.equal(view.clock, now - 5000);
    assert.equal(view.you?.team, 'you');

    release();
    await locking;

    const advanced = await roomView('seat-1');
    assert.ok(Math.abs((advanced.game?.elapsed ?? 0) - 1.65) < 1e-9);
    const saved = roomFromJson((await kv.get(ROOM_KEY))!);
    assert.ok(Math.abs(saved.game.elapsed - 1.65) < 1e-9);
  });

  test('two overlapping polls tick the room once', async () => {
    const kv = createMemoryKv();
    setRoomKvForTests(kv);
    const now = Date.now();
    const room = blankRoom(now - 5000);
    room.started = true;
    room.paused = false;
    room.clock = now - 5000;
    room.seats = [
      { id: 'seat-1', name: 'Анна', team: 'you', seen: now, ready: false },
      { id: 'seat-2', name: 'Борис', team: 'red', seen: now, ready: false },
    ];
    await kv.set(ROOM_KEY, roomToJson(room));

    const started = Date.now();
    const [left, right] = await Promise.all([
      roomView('seat-1'),
      roomView('seat-2'),
    ]);
    const waited = Date.now() - started;
    assert.ok(waited < 100, `overlapping polls waited ${waited}ms`);
    const saved = roomFromJson((await kv.get(ROOM_KEY))!);
    assert.ok(Math.abs(saved.game.elapsed - 0.4) < 1e-9);
    const seen = [left.game?.elapsed ?? -1, right.game?.elapsed ?? -1];
    assert.ok(
      seen.every((n) => Math.abs(n) < 1e-9 || Math.abs(n - 0.4) < 1e-9),
      `views ${seen.join(',')}`,
    );
    assert.ok(Math.abs(Math.max(...seen) - 0.4) < 1e-9);
    assert.equal(saved.seats[0].id, 'seat-1');
    assert.equal(saved.seats[1].id, 'seat-2');
  });

  test('the lock does not let two callers overlap', async () => {
    const kv = createMemoryKv();
    let inside = 0;
    let max = 0;
    await Promise.all(
      [0, 1].map(() =>
        withLock(kv, async () => {
          inside += 1;
          max = Math.max(max, inside);
          await new Promise((resolve) => setTimeout(resolve, 40));
          inside -= 1;
        }),
      ),
    );
    assert.equal(max, 1);
    assert.equal(inside, 0);
  });

  test('any complete redis env pair selects redis and the first pair wins', () => {
    for (const [urlName, tokenName] of REDIS_ENV_PAIRS) {
      clearRedisEnv();
      delete process.env.VERCEL;
      process.env[urlName] = 'https://example.upstash.io';
      process.env[tokenName] = 'test-token';
      assert.equal(storeMode(), 'redis');
      assert.equal(redisCredentials()?.url, 'https://example.upstash.io');
    }

    clearRedisEnv();
    process.env.UPSTASH_REDIS_REST_URL = 'https://first.example';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'first-token';
    process.env.STORAGE_URL = 'https://second.example';
    process.env.STORAGE_TOKEN = 'second-token';
    assert.equal(redisCredentials()?.url, 'https://first.example');

    clearRedisEnv();
    process.env.UPSTASH_REDIS_REST_URL = '   ';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'unused';
    process.env.STORAGE_URL = 'https://storage.example';
    process.env.STORAGE_TOKEN = 'storage-token';
    assert.equal(redisCredentials()?.url, 'https://storage.example');

    clearRedisEnv();
    delete process.env.VERCEL;
    assert.equal(storeMode(), 'memory');
  });

  test('vercel without redis refuses a private room', async () => {
    setRoomKvForTests(null);
    process.env.VERCEL = '1';
    clearRedisEnv();
    assert.equal(storeMode(), 'missing');
    const view = await roomView('seat-1');
    assert.equal(view.code, 'redis_missing');
    assert.equal(view.error, REDIS_MISSING_ERROR);
    assert.equal(view.seats, undefined);
    const joined = await roomCommand({ op: 'join', team: 'red', name: 'Борис' });
    assert.equal(joined.code, 'redis_missing');
    delete process.env.VERCEL;
    assert.equal(storeMode(), 'memory');
  });

  test('vercel without redis returns json from the handler', async () => {
    setRoomKvForTests(null);
    process.env.VERCEL = '1';
    clearRedisEnv();
    const response = await GET(new Request('http://localhost/api/room'));
    const body = (await response.json()) as { error?: string; code?: string };
    assert.equal(response.status, 503);
    assert.equal(body.code, 'redis_missing');
    assert.equal(body.error, REDIS_MISSING_ERROR);
    delete process.env.VERCEL;
  });

  test('a redis rest failure returns json and does not leak the token', async () => {
    setRoomKvForTests(null);
    process.env.VERCEL = '1';
    clearRedisEnv();
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'WRONGPASS invalid auth token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    try {
      const response = await GET(new Request('http://localhost/api/room'));
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        status?: number;
        reason?: string;
      };
      const encoded = JSON.stringify(body);
      assert.equal(response.status, 503);
      assert.equal(body.code, 'redis_error');
      assert.equal(body.status, 401);
      assert.match(body.reason || '', /WRONGPASS/);
      assert.equal(encoded.includes('test-token'), false);
    } finally {
      globalThis.fetch = original;
      delete process.env.VERCEL;
      clearRedisEnv();
    }
  });

  test('a missing redis url does not crash the handler', async () => {
    setRoomKvForTests(null);
    process.env.VERCEL = '1';
    clearRedisEnv();
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:9';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    const response = await GET(new Request('http://localhost/api/room'));
    const body = (await response.json()) as { code?: string; reason?: string };
    const encoded = JSON.stringify(body);
    assert.equal(response.status, 503);
    assert.equal(body.code, 'redis_error');
    assert.equal(body.reason, 'fetch failed');
    assert.equal(encoded.includes('test-token'), false);
    delete process.env.VERCEL;
    clearRedisEnv();
  });
});
