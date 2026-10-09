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
import { initialGame, tick } from './tower-game';
import { battleRenderInput, reactStamp, skipBattleRender } from './live-view';
import {
  applyRoomTransport,
  applyTroopOps,
  diffTroops,
  makeRoomTransport,
  payloadBytes,
} from './room-protocol';
import { POST } from '../app/api/room/route';

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
    assert.equal(again.seats?.[0].name, 'Анна');
  });

  test('room transport applies full then compact delta', () => {
    const room = blankRoom(1000);
    room.started = true;
    room.revision = 1;
    room.seats = [
      { id: 'seat-1', name: 'Анна', team: 'you', seen: 1000, ready: false },
    ];
    const full = makeRoomTransport(
      {
        seats: [{ name: 'Анна', team: 'you', ready: false }],
        started: true,
        paused: false,
        startAt: null,
        game: room.game,
        you: { team: 'you', ready: false },
        revision: 1,
      },
      null,
    );
    assert.equal(full.transport, 'full');
    const applied = applyRoomTransport(null, full);
    assert.ok(applied?.game);

    const nextGame = {
      ...room.game,
      age: 0.05,
      elapsed: 0.05,
      notice: 'changed',
    };
    const delta = makeRoomTransport(
      {
        seats: [{ name: 'Анна', team: 'you', ready: false }],
        started: true,
        paused: false,
        startAt: null,
        game: nextGame,
        you: { team: 'you', ready: false },
        revision: 2,
      },
      applied!.cursor,
    );
    assert.equal(delta.transport, 'delta');
    if (delta.transport !== 'delta') return;
    assert.deepEqual(Object.keys(delta.game ?? {}).sort(), [
      'age',
      'elapsed',
      'notice',
    ]);
    const updated = applyRoomTransport(applied, delta);
    assert.equal(updated?.game?.notice, 'changed');
    assert.strictEqual(updated?.game?.towers, applied?.game?.towers);
  });

  test('stale out-of-order delta requests a full resync', () => {
    const view = {
      seats: [] as { name: string; team: 'you'; ready: boolean }[],
      started: false,
      paused: false,
      startAt: null,
      game: null,
      you: null,
      revision: 1,
    };
    const first = applyRoomTransport(null, makeRoomTransport(view, null));
    assert.ok(first);
    const secondMessage = makeRoomTransport(
      { ...view, paused: true, revision: 2 },
      first!.cursor,
    );
    const second = applyRoomTransport(first, secondMessage);
    assert.ok(second);
    assert.equal(applyRoomTransport(second, secondMessage), null);
  });

  test('reload with a seat id restores the same player', async () => {
    const kv = createMemoryKv();
    setRoomKvForTests(kv);
    const joined = await roomCommand({ op: 'join', team: 'purple', name: 'Ира' });
    const reloaded = await roomView(joined.playerId!);
    const full = makeRoomTransport(reloaded, null);
    const applied = applyRoomTransport(null, full);
    assert.equal(applied?.you?.team, 'purple');
    assert.equal(applied?.seats[0].name, 'Ира');
  });

  test('two players receive the same authoritative game revision', async () => {
    const kv = createMemoryKv();
    setRoomKvForTests(kv);
    const now = Date.now();
    const room = blankRoom(now);
    room.started = true;
    room.paused = true;
    room.revision = 7;
    room.seats = [
      { id: 'seat-1', name: 'Анна', team: 'you', seen: now, ready: false },
      { id: 'seat-2', name: 'Борис', team: 'red', seen: now, ready: false },
    ];
    await kv.set(ROOM_KEY, roomToJson(room));
    const left = await roomView('seat-1');
    const right = await roomView('seat-2');
    assert.equal(left.revision, right.revision);
    assert.equal(left.revision, 7);
    assert.deepEqual(left.game, right.game);
    assert.equal(left.you?.team, 'you');
    assert.equal(right.you?.team, 'red');
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

  test('troop moves are a small delta and keep every other tower', () => {
    const room = blankRoom(1000);
    room.started = true;
    room.revision = 4;
    room.game = {
      ...room.game,
      troops: Array.from({ length: 1000 }, (_, index) => ({
        id: index + 1,
        team: 'you' as const,
        from: 0,
        to: 1,
        x: 10 + (index % 30) * 0.1,
        y: 12 + (index % 17) * 0.1,
        sx: 10,
        sy: 12,
        progress: 0.2,
        delay: 0,
        speech: '',
        cargo: false,
        strength: 1,
      })),
      nextId: 1001,
    };
    const baseView = {
      seats: [] as { name: string; team: 'you'; ready: boolean }[],
      started: true,
      paused: true,
      startAt: null,
      game: room.game,
      you: { team: 'you' as const, ready: false },
      revision: 4,
    };
    const full = makeRoomTransport(baseView, null);
    const applied = applyRoomTransport(null, full);
    assert.ok(applied?.game);
    const move = (count: number) => ({
      ...room.game,
      troops: room.game.troops.map((troop, index) =>
        index < count
          ? { ...troop, x: troop.x + 1.25, y: troop.y + 0.4, progress: troop.progress + 0.05 }
          : troop,
      ),
    });
    const one = move(1);
    const oneDelta = diffTroops(room.game.troops, one.troops);
    const oneMessage = makeRoomTransport(
      {
        ...baseView,
        revision: 5,
        game: one,
        troopJournal: { from: 4, ...oneDelta },
      },
      applied!.cursor,
    );
    const ten = move(10);
    const tenDelta = diffTroops(room.game.troops, ten.troops);
    const tenMessage = makeRoomTransport(
      {
        ...baseView,
        revision: 5,
        game: ten,
        troopJournal: { from: 4, ...tenDelta },
      },
      applied!.cursor,
    );
    const unchanged = makeRoomTransport(baseView, applied!.cursor);
    const fullBytes = payloadBytes(full);
    const noopBytes = payloadBytes(unchanged);
    const oneBytes = payloadBytes(oneMessage);
    const tenBytes = payloadBytes(tenMessage);
    console.log(
      `PAYLOAD noop=${noopBytes} oneTroop=${oneBytes} tenTroops=${tenBytes} full=${fullBytes}`,
    );
    assert.equal(unchanged.transport, 'noop');
    assert.ok(noopBytes < 80, `noop ${noopBytes}`);
    assert.equal(oneMessage.transport, 'delta');
    assert.equal(tenMessage.transport, 'delta');
    assert.ok(oneBytes < 5000, `one troop delta ${oneBytes}`);
    assert.ok(tenBytes < 5000, `ten troop delta ${tenBytes}`);
    assert.ok(fullBytes > 10000, `full ${fullBytes}`);
    if (oneMessage.transport !== 'delta' || tenMessage.transport !== 'delta') return;
    assert.equal(oneMessage.game?.troops?.ops.length, 1);
    assert.equal(oneMessage.game?.troops?.ops[0]?.[0], 'm');
    assert.equal(oneMessage.game?.towerPatch, undefined);
    const updated = applyRoomTransport(applied, oneMessage);
    const fullOne = applyRoomTransport(null, makeRoomTransport({ ...baseView, revision: 5, game: one }, null));
    assert.deepEqual(updated?.game?.troops, fullOne?.game?.troops);
    assert.strictEqual(updated?.game?.towers, applied?.game?.towers);
    assert.strictEqual(updated?.game?.routes, applied?.game?.routes);
    assert.equal(reactStamp(applied!.game!), reactStamp(updated!.game!));
    const ui = {
      me: 'you' as const,
      selected: 0,
      speech: true,
      routeMode: true,
      scoutMode: false,
      paused: false,
      help: false,
      recording: false,
    };
    let battleRenders = 1;
    if (!skipBattleRender(battleRenderInput(applied!.game!, ui), battleRenderInput(updated!.game!, ui)))
      battleRenders += 1;
    assert.equal(battleRenders, 1);
    console.log('browser FPS was not re-measured');
    const tenApplied = applyRoomTransport(applied, tenMessage);
    const fullTen = applyRoomTransport(
      null,
      makeRoomTransport({ ...baseView, revision: 5, game: ten }, null),
    );
    assert.deepEqual(tenApplied?.game?.troops, fullTen?.game?.troops);
    assert.strictEqual(tenApplied?.game?.towers[3], applied?.game?.towers[3]);
  });

  test('a real tick delta matches the troop list and a missed revision resyncs', () => {
    let game = initialGame();
    game = {
      ...game,
      troops: [
        {
          id: 1,
          team: 'you',
          from: 0,
          to: 6,
          x: game.towers[0].x,
          y: game.towers[0].y,
          sx: game.towers[0].x,
          sy: game.towers[0].y,
          progress: 0,
          delay: 0,
          speech: '',
          cargo: false,
          strength: 4,
        },
      ],
      nextId: 2,
    };
    const ticked = tick(game, 0.05);
    const delta = diffTroops(game.troops, ticked.troops);
    assert.deepEqual(applyTroopOps(game.troops, delta), ticked.troops);
    const view = {
      seats: [] as { name: string; team: 'you'; ready: boolean }[],
      started: true,
      paused: false,
      startAt: null,
      game,
      you: null,
      revision: 1,
    };
    const applied = applyRoomTransport(null, makeRoomTransport(view, null));
    const stepped = makeRoomTransport(
      { ...view, game: ticked, revision: 2, troopJournal: { from: 1, ...delta, towers: undefined } },
      applied!.cursor,
    );
    assert.equal(stepped.transport, 'delta');
    if (stepped.transport !== 'delta') return;
    const jumped = makeRoomTransport(
      { ...view, game: tick(ticked, 0.05), revision: 3, troopJournal: { from: 2, ops: [] } },
      applied!.cursor,
    );
    assert.equal(jumped.transport, 'full');
    assert.equal(applyRoomTransport(applied, { ...stepped, base: 'stale' }), null);
  });

  test('started match rejoins the same seat and rejects a new player', async () => {
    const kv = createMemoryKv();
    setRoomKvForTests(kv);
    const now = Date.now();
    const room = blankRoom(now);
    room.started = true;
    room.paused = true;
    room.seats = [
      { id: 'seat-anna', name: 'Анна', team: 'you', seen: now, ready: false },
    ];
    await kv.set(ROOM_KEY, roomToJson(room));
    const again = await roomCommand({
      op: 'join',
      playerId: 'seat-anna',
      team: 'red',
      name: 'Анна',
    });
    assert.equal(again.error, undefined);
    assert.equal(again.playerId, 'seat-anna');
    assert.equal(again.you?.team, 'you');
    const stranger = await roomCommand({ op: 'join', team: 'red', name: 'Борис' });
    assert.match(stranger.error || '', /Матч уже идёт/);
    assert.equal(stranger.playerId, undefined);
    const loaded = roomFromJson((await kv.get(ROOM_KEY))!);
    assert.equal(loaded.seats.length, 1);
    assert.equal(loaded.seats[0].id, 'seat-anna');
  });

  test('an attack POST delta is visible without another poll', async () => {
    const kv = createMemoryKv();
    setRoomKvForTests(kv);
    const now = Date.now();
    const room = blankRoom(now);
    room.started = true;
    room.paused = false;
    room.clock = now;
    room.revision = 2;
    room.seats = [
      { id: 'seat-1', name: 'Анна', team: 'you', seen: now, ready: false },
      { id: 'seat-2', name: 'Борис', team: 'red', seen: now, ready: false },
    ];
    room.game = { ...room.game, humans: ['you', 'red'] };
    await kv.set(ROOM_KEY, roomToJson(room));
    const viewed = await roomView('seat-1');
    const cursor = makeRoomTransport(viewed, null);
    const seated = applyRoomTransport(null, cursor);
    const response = await POST(
      new Request('http://localhost/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'action',
          playerId: 'seat-1',
          cursor: seated!.cursor,
          action: { type: 'army', from: 0, to: 1, fraction: 1 },
        }),
      }),
    );
    const body = (await response.json()) as {
      spellNonce?: number | null;
      transport?: ReturnType<typeof makeRoomTransport>;
      game?: unknown;
    };
    assert.equal(response.status, 200);
    assert.equal(body.game, undefined);
    assert.equal(body.transport?.transport, 'delta');
    const applied = applyRoomTransport(seated, body.transport!);
    assert.ok((applied?.game?.troops.length ?? 0) > 0);
    assert.ok((applied?.game?.troops.length ?? 0) < 40);
    if (body.transport?.transport === 'delta') {
      assert.ok(payloadBytes(body.transport) < 8000);
      const spawned = body.transport.game?.troops?.ops.filter((op) => op[0] === 's') ?? [];
      assert.ok(spawned.length > 0);
    }
    const other = await roomView('seat-2');
    assert.equal(other.game?.troops.length, applied?.game?.troops.length);
    assert.equal(other.revision, applied?.revision);
  });

  test('four polls share one clock and a lock miss does not double-advance', async () => {
    const kv = createMemoryKv();
    setRoomKvForTests(kv);
    const now = Date.now();
    const room = blankRoom(now - 5000);
    room.started = true;
    room.paused = false;
    room.clock = now - 5000;
    room.game = { ...room.game, elapsed: 1.25 };
    room.seats = [1, 2, 3, 4].map((n) => ({
      id: `seat-${n}`,
      name: `Игрок ${n}`,
      team: (['you', 'red', 'purple', 'green'] as const)[n - 1],
      seen: now,
      ready: false,
    }));
    await kv.set(ROOM_KEY, roomToJson(room));
    const views = await Promise.all([1, 2, 3, 4].map((n) => roomView(`seat-${n}`)));
    const saved = roomFromJson((await kv.get(ROOM_KEY))!);
    assert.ok(Math.abs(saved.game.elapsed - 1.65) < 1e-9, `elapsed ${saved.game.elapsed}`);
    for (const view of views) {
      const elapsed = view.game?.elapsed ?? -1;
      assert.ok(
        Math.abs(elapsed - 1.25) < 1e-9 || Math.abs(elapsed - 1.65) < 1e-9,
        `clock ${elapsed}`,
      );
    }
    assert.equal(views[0].game?.troops.length, views[1].game?.troops.length);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locking = withLock(kv, () => gate);
    const missed = await roomView('seat-1');
    assert.ok(Math.abs((missed.game?.elapsed ?? -1) - saved.game.elapsed) < 1e-9);
    release();
    await locking;
    const next = await roomView('seat-2');
    assert.ok(
      Math.abs((next.game?.elapsed ?? 0) - saved.game.elapsed) < 0.2,
      `jumped to ${next.game?.elapsed}`,
    );
  });

  test('bots do not march or cast during the first four minutes and gold mines do not recruit', () => {
    let game = initialGame();
    game = {
      ...game,
      towers: game.towers.map((tower) =>
        tower.kind === 'gold' ? { ...tower, team: 'you' as const, count: 5 } : tower,
      ),
    };
    const goldBefore = game.towers.find((tower) => tower.kind === 'gold')!.count;
    for (let i = 0; i < 400; i++) game = tick(game, 0.05);
    assert.ok(game.age < 240);
    assert.equal(
      game.troops.filter((troop) => troop.team !== 'you').length,
      0,
    );
    assert.equal(game.spell, undefined);
    const gold = game.towers.find((tower) => tower.kind === 'gold' && tower.team === 'you')!;
    assert.equal(gold.count, goldBefore);
  });
});
