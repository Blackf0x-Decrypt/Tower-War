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
});
