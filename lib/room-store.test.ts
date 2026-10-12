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
import {
  DECREE_RESPONSE_SECONDS,
  DEVELOPMENT_SECONDS,
  applyDecree,
  decreeVeto,
  humanTeams,
  initialGame,
  readySpell,
  recallTroops,
  refreshAuthority,
  sendArmy,
  startSpell,
  teamIncome,
  teamAlive,
  TEAM_IDS,
  tick,
} from './tower-game';
import {
  localCustomCandidate,
  DEFAULT_DECREE_SEED,
  decreePromptForCandidates,
  gameDecreeContextSeed,
  localDecreeCandidates,
  localCustomDecree,
  sanitizeDecreeCandidates,
  validDecree,
  validPlayerDecree,
} from './decrees';
import { SEAT_AWAY_MS, SEAT_RELEASE_MS } from './room';
import { battleRenderInput, reactStamp, skipBattleRender } from './live-view';
import {
  applyRoomTransport,
  applyTroopOps,
  diffTroops,
  makeRoomTransport,
  payloadBytes,
} from './room-protocol';
import {
  needsFullBootstrapRetry,
  roomBootstrapReducer,
  safeRoomError,
} from './room-bootstrap';
import { POST } from '../app/api/room/route';
import {
  assertSymmetricStartWallets,
  chaosMineBirthEligible,
  garrisonRecruitAllowed,
} from './economy-rules';
import {
  isRoomBusy,
  roomBusyBackoffMs,
  ROOM_BUSY_MAX_RETRIES,
} from './room-client';
import { registryCoversAllKinds } from './chaos-registry';
import { pickTroopRole, roleMult } from './troop-rules';
import { production } from './tower-game';

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

  test('bootstrap state always exits its restoring screen', () => {
    assert.equal(roomBootstrapReducer('idle', { type: 'start' }), 'loading');
    assert.equal(
      roomBootstrapReducer('loading', {
        type: 'failure',
        message: 'Комната временно недоступна.',
      }),
      'error',
    );
    assert.equal(
      roomBootstrapReducer('loading', { type: 'released' }),
      'idle',
    );
    assert.equal(
      roomBootstrapReducer('loading', { type: 'complete' }),
      'idle',
    );
  });

  test('bootstrap retries a delta or noop that has no full base', () => {
    assert.equal(
      needsFullBootstrapRetry(
        {
          transport: 'delta',
          protocol: 2,
          revision: 4,
          base: 'stale-cursor',
          cursor: 'new-cursor',
        },
        null,
      ),
      true,
    );
    assert.equal(
      needsFullBootstrapRetry(
        { transport: 'noop', protocol: 2, revision: 4 },
        null,
      ),
      true,
    );
    assert.equal(
      needsFullBootstrapRetry(
        { transport: 'full', protocol: 2, revision: 4, cursor: 'cursor', seats: [], started: false, paused: false, startAt: null, you: null, game: null },
        { revision: 4 },
      ),
      false,
    );
  });

  test('bootstrap keeps only safe server errors and maps timeouts to retryable state', () => {
    assert.equal(
      safeRoomError({ error: 'Комната занята.', code: 'room_busy' }),
      'Комната занята.',
    );
    assert.equal(
      safeRoomError({ error: 'x'.repeat(181) }),
      'Комната временно недоступна. Попробуйте ещё раз.',
    );
    assert.equal(
      roomBootstrapReducer('loading', {
        type: 'failure',
        message: 'Не удалось связаться с комнатой за 10 секунд.',
      }),
      'error',
    );
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

  test('bots act from match start without a resource or troop advantage', () => {
    let game = initialGame();
    game = {
      ...game,
      humans: ['you', 'red', 'purple'],
      towers: game.towers.map((tower) =>
        tower.kind === 'gold' ? { ...tower, team: 'you' as const, count: 5 } : tower,
      ),
    };
    const goldBefore = game.towers.find((tower) => tower.kind === 'gold')!.count;
    const greenBefore = game.wallets.green.gold;
    for (let i = 0; i < 240; i++) game = tick(game, 0.05);
    assert.ok(game.age < 240);
    assert.ok(game.troops.some((troop) => troop.team === 'green'));
    assert.ok(
      game.wallets.green.gold <= greenBefore,
      'bot received no direct gold grant',
    );
    assert.equal(game.spell, undefined);
    const gold = game.towers.find((tower) => tower.kind === 'gold' && tower.team === 'you')!;
    assert.equal(gold.count, goldBefore);
    assert.deepEqual(humanTeams(game), ['you', 'red', 'purple']);
  });

  test('same mine configuration earns the same gold for every team', () => {
    const base = initialGame();
    assert.deepEqual(
      TEAM_IDS.map((team) => base.wallets[team]),
      [base.wallets.you, base.wallets.you, base.wallets.you, base.wallets.you],
    );
    assert.equal(
      base.towers.filter((tower) => tower.kind === 'supply').length,
      4,
    );
    const mine = base.towers.find((tower) => tower.kind === 'gold')!;
    const game = {
      ...base,
      towers: base.towers.map((tower) =>
        tower.id === mine.id
          ? { ...tower, level: 2, specialty: 'economy' as const, count: 30 }
          : tower,
      ),
    };
    const incomes = TEAM_IDS.map((team) =>
      teamIncome(
        {
          ...game,
          towers: game.towers.map((tower) =>
            tower.id === mine.id ? { ...tower, team } : tower,
          ),
        },
        team,
      ).gold,
    );
    assert.deepEqual(incomes, [incomes[0], incomes[0], incomes[0], incomes[0]]);
  });

  test('decree candidates without typed player prompt', () => {
    const seed = decreePromptForCandidates(undefined, undefined);
    assert.equal(seed, DEFAULT_DECREE_SEED);
    const preset = localDecreeCandidates(seed);
    assert.equal(preset.length, 3);
    assert.ok(preset.every((choice) => validPlayerDecree(choice.patch)));
    const contextual = localDecreeCandidates(
      gameDecreeContextSeed({
        elapsed: 260,
        towers: 5,
        earned: 88,
        epoch: 3,
      }),
    );
    assert.equal(contextual.length, 3);
    assert.ok(contextual.every((choice) => validPlayerDecree(choice.patch)));
    const unsafe = sanitizeDecreeCandidates([
      preset[0],
      {
        ...preset[1],
        patch: { kind: 'reinforce', target: 'everyone', amount: 25 },
      },
      preset[2],
    ]);
    assert.equal(unsafe.length, 0);
  });

  test('decree choice window, fallback candidates, custom DSL, and leadership guard', () => {
    const choices = localDecreeCandidates('укрепить рубеж');
    assert.equal(choices.length, 3);
    assert.ok(choices.every((choice) => validDecree(choice.patch)));
    assert.ok(choices.every((choice) => validPlayerDecree(choice.patch)));
    assert.ok(choices.every((choice) => choice.sideEffect.length > 0));
    assert.ok(validDecree(localCustomDecree('ускорить марш')!));
    assert.ok(validPlayerDecree(localCustomDecree('ускорить марш')!));
    assert.ok(validPlayerDecree(localCustomDecree('дай штабу 20')!));
    assert.equal(localCustomDecree('уничтожь красных'), null);
    assert.ok(validPlayerDecree(localCustomDecree('туман войны')!));
    assert.ok(validPlayerDecree(localCustomDecree('монополия дохода')!));
    assert.ok(validPlayerDecree(localCustomDecree('зеркальная волна')!));
    assert.ok(validPlayerDecree(localCustomDecree('перекраска карты')!));
    assert.ok(validPlayerDecree(localCustomDecree('рой автовыбросов')!));
    assert.ok(
      choices.every(
        (choice) =>
          !JSON.stringify(choice.patch).includes('"kind":"gold"') ||
          choice.title.includes('Ваш'),
      ),
    );
    assert.ok(localCustomCandidate('дай штабу 20')?.sideEffect.length);

    let game = initialGame();
    game = {
      ...game,
      age: DEVELOPMENT_SECONDS,
      elapsed: DEVELOPMENT_SECONDS,
      authority: 'you',
      authorityEpoch: 4,
      leaderSince: DEVELOPMENT_SECONDS,
      wallets: {
        ...game.wallets,
        you: { ...game.wallets.you, earned: 100 },
      },
    };
    const deepSeekGlobalCandidate = {
      id: 'unsafe',
      title: 'Всем поровну',
      flavor: 'Небезопасный ответ модели.',
      description: '+25 бойцов всем.',
      sideEffect: 'Без довеска.',
      patch: { kind: 'reinforce' as const, target: 'everyone' as const, amount: 25 },
    };
    assert.ok(validDecree(deepSeekGlobalCandidate.patch));
    assert.equal(validPlayerDecree(deepSeekGlobalCandidate.patch), false);
    const redHqBefore = game.towers.find((tower) => tower.home === 'red')!.count;
    const rejectedGlobal = applyDecree(
      game,
      'you',
      deepSeekGlobalCandidate.patch,
      4,
    );
    assert.equal(
      rejectedGlobal.towers.find((tower) => tower.home === 'red')!.count,
      redHqBefore,
    );
    const expiredWindow = startSpell(
      { ...game, age: DEVELOPMENT_SECONDS + DECREE_RESPONSE_SECONDS },
      'you',
      choices[0].title,
    );
    assert.equal(expiredWindow.spell, undefined);
    const tied = refreshAuthority({
      ...game,
      wallets: {
        ...game.wallets,
        red: { ...game.wallets.red, earned: 100 },
      },
    });
    assert.equal(tied.authority, null);
    assert.equal(tied.authorityEpoch, 5);
    game = startSpell(game, 'you', choices[0].title);
    assert.ok(game.spell);
    const expired = tick(
      { ...game, age: game.age + DECREE_RESPONSE_SECONDS + 0.01 },
      0.05,
    );
    assert.equal(expired.spell, undefined);

    game = startSpell({ ...game, spell: undefined }, 'you', choices[0].title);
    const armed = readySpell(
      game,
      choices[0].patch,
      4,
      null,
      'disabled',
    );
    assert.ok(armed.spell?.patch);
    const applied = applyDecree(
      { ...armed, spell: undefined },
      'you',
      choices[0].patch,
      4,
    );
    assert.ok(applied.decreeLog[0]?.text.length > 0);
    assert.ok(
      (applied.chaosRules?.length ?? 0) > 0 ||
        (applied.shielded?.you ?? 0) > applied.age ||
        applied.decreeLog[0].text.includes('Нейтралы') ||
        applied.decreeLog[0].text.includes('Переставлено'),
    );
    assert.equal(
      applied.towers.find((tower) => tower.home === 'red')!.count,
      redHqBefore,
    );
    const rippleGame = {
      ...game,
      spell: undefined,
      authority: 'you' as const,
      authorityEpoch: game.authorityEpoch,
    };
    const ripplePatch = localCustomDecree('волна нейтралов от штаба')!;
    const rippled = applyDecree(
      rippleGame,
      'you',
      ripplePatch,
      rippleGame.authorityEpoch,
    );
    assert.ok(
      rippled.decreeLog.some((entry) => entry.text.includes('Волна')) ||
        rippled.decreeLog.some((entry) => entry.text.includes('нейтрал')),
    );
    const monopolyPatch = localCustomDecree('монополия дохода')!;
    const monopolized = applyDecree(
      { ...rippleGame, decreeLog: [] },
      'you',
      monopolyPatch,
      rippleGame.authorityEpoch,
    );
    assert.ok((monopolized.chaosRules?.length ?? 0) > 0);
    const lostLead = { ...game, authority: 'red' as const, authorityEpoch: 5 };
    const rejected = readySpell(
      lostLead,
      choices[0].patch,
      4,
      null,
      'disabled',
    );
    assert.equal(rejected, lostLead);
  });
});

describe('match end', () => {
  function withAge(game: ReturnType<typeof initialGame>, age: number) {
    return { ...game, age, elapsed: age, troops: [] as typeof game.troops };
  }

  test('after 4:00 only one team with buildings wins, and gold 0 with an HQ does not', () => {
    const opened = initialGame();
    const sole = tick(
      withAge(
        {
          ...opened,
          towers: opened.towers.map((tower) =>
            tower.home === 'red' || tower.team === 'red'
              ? { ...tower, team: 'red' as const, count: Math.max(tower.count, 8) }
              : { ...tower, team: null, home: undefined, count: 0 },
          ),
        },
        DEVELOPMENT_SECONDS,
      ),
      0.05,
    );
    assert.equal(sole.result, 'red');
    assert.equal(teamAlive(sole, 'red'), true);
    assert.equal(teamAlive(sole, 'you'), false);

    const nobody = tick(
      withAge(
        {
          ...opened,
          towers: opened.towers.map((tower) => ({
            ...tower,
            team: null,
            home: undefined,
            count: 0,
          })),
        },
        DEVELOPMENT_SECONDS,
      ),
      0.05,
    );
    assert.equal(nobody.result, 'draw');

    const early = tick(
      withAge(
        {
          ...opened,
          towers: opened.towers.map((tower) =>
            tower.home === 'red' || tower.team === 'red'
              ? { ...tower, team: 'red' as const, count: Math.max(tower.count, 8) }
              : { ...tower, team: null, home: undefined, count: 0 },
          ),
        },
        DEVELOPMENT_SECONDS - 30,
      ),
      0.05,
    );
    assert.ok(early.age < DEVELOPMENT_SECONDS);
    assert.equal(early.result, null);

    const gone = {
      ...opened,
      towers: opened.towers.map((tower) =>
        tower.team === 'you' || tower.home === 'you'
          ? { ...tower, team: null, home: undefined, count: 0 }
          : tower,
      ),
    };
    assert.equal(teamAlive(gone, 'you'), false);

    const funded = withAge(
      {
        ...opened,
        wallets: {
          ...opened.wallets,
          you: { ...opened.wallets.you, gold: 0 },
        },
        towers: opened.towers.map((tower) =>
          tower.home ? { ...tower, team: tower.home, count: 12 } : tower,
        ),
      },
      DEVELOPMENT_SECONDS,
    );
    assert.equal(funded.wallets.you.gold, 0);
    assert.equal(teamAlive(funded, 'you'), true);
    assert.equal(tick(funded, 0.05).result, null);

    const emptyHq = withAge(
      {
        ...opened,
        authority: 'you' as const,
        authorityEpoch: 3,
        humans: ['you', 'red', 'purple', 'green'] as const,
        wallets: {
          ...opened.wallets,
          you: { gold: 0, resources: 0, earned: 400 },
        },
        towers: opened.towers.map((tower) => {
          if (tower.home === 'you') return { ...tower, team: 'you' as const, count: 0 };
          if (tower.home) return { ...tower, team: tower.home, count: 20 };
          return tower;
        }),
      },
      DEVELOPMENT_SECONDS,
    );
    assert.equal(emptyHq.wallets.you.gold, 0);
    assert.equal(teamAlive(emptyHq, 'you'), true);
    assert.equal(
      teamAlive(
        {
          ...emptyHq,
          towers: emptyHq.towers.map((tower) =>
            tower.home === 'you' ? { ...tower, count: 0.4 } : tower,
          ),
        },
        'you',
      ),
      true,
    );
    assert.equal(tick(emptyHq, 0.05).result, null);
    const reinforced = applyDecree(
      emptyHq,
      'you',
      { kind: 'reinforce', target: 'main', amount: 12 },
      3,
    );
    const reinforcedHq = reinforced.towers.find((tower) => tower.home === 'you')!;
    assert.ok(reinforcedHq.count >= 12, `reinforced ${reinforcedHq.count}`);
    const ruined = {
      ...emptyHq,
      towers: emptyHq.towers.map((tower) =>
        tower.home === 'you' ? { ...tower, ruinedAt: 1, count: 0 } : tower,
      ),
    };
    assert.equal(teamAlive(ruined, 'you'), false);
    const denied = applyDecree(
      ruined,
      'you',
      { kind: 'reinforce', target: 'main', amount: 12 },
      3,
    );
    const ruinedHq = denied.towers.find((tower) => tower.home === 'you')!;
    assert.equal(ruinedHq.count, 0);
    assert.equal(ruinedHq.team, null);
    const wiped = withAge(
      {
        ...opened,
        towers: opened.towers.map((tower) => {
          if (tower.home === 'you' || tower.team === 'you')
            return { ...tower, team: 'you' as const, count: 8, ruinedAt: 1 };
          if (tower.home) return { ...tower, team: 'red' as const, home: 'red' as const, count: 20 };
          return { ...tower, team: null, count: 0 };
        }),
      },
      DEVELOPMENT_SECONDS,
    );
    assert.equal(teamAlive(wiped, 'you'), false);
    assert.equal(tick(wiped, 0.05).result, 'red');

    const barracks = opened.towers.find((tower) => tower.kind === 'barracks' && tower.x < 50)!;
    const hq = opened.towers.find((tower) => tower.home === 'you')!;
    let returning = {
      ...opened,
      humans: ['you', 'red', 'purple', 'green'] as const,
      towers: opened.towers.map((tower) => {
        if (tower.id === hq.id) return { ...tower, count: 0 };
        if (tower.id === barracks.id) return { ...tower, team: 'you' as const, count: 16 };
        return tower;
      }),
    };
    returning = sendArmy(returning, barracks.id, hq.id, 1);
    returning = {
      ...returning,
      troops: returning.troops.map((troop) => ({ ...troop, progress: 0.999, delay: 0 })),
    };
    returning = tick(returning, 0.05);
    assert.ok(
      returning.towers.find((tower) => tower.id === hq.id)!.count >= 1,
      'arrival onto 0',
    );
    let recalled = sendArmy(
      {
        ...opened,
        towers: opened.towers.map((tower) =>
          tower.id === hq.id ? { ...tower, count: 10 } : tower,
        ),
      },
      hq.id,
      barracks.id,
      1,
    );
    recalled = {
      ...recalled,
      towers: recalled.towers.map((tower) =>
        tower.id === hq.id ? { ...tower, count: 0 } : tower,
      ),
    };
    recalled = recallTroops(recalled, 'you', hq.id, null);
    assert.ok(recalled.towers.find((tower) => tower.id === hq.id)!.count >= 1, 'recall onto 0');
    const gold = opened.towers.find((tower) => tower.kind === 'gold')!;
    let regen = {
      ...emptyHq,
      towers: emptyHq.towers.map((tower) =>
        tower.id === gold.id ? { ...tower, team: 'you' as const, count: 0 } : tower,
      ),
    };
    for (let i = 0; i < 40; i++) regen = tick(regen, 0.05);
    assert.ok(regen.towers.find((tower) => tower.id === hq.id)!.count >= 1, 'hq recruits from 0');
    assert.equal(regen.towers.find((tower) => tower.id === gold.id)!.count, 0);
  });
});

describe('seat release and four players', { concurrency: 1 }, () => {
  before(() => {
    clearRedisEnv();
    delete process.env.VERCEL;
    setRoomKvForTests(null);
  });

  after(() => {
    setRoomKvForTests(null);
    restoreEnv();
  });

  function memory() {
    const kv = createMemoryKv();
    setRoomKvForTests(kv);
    return kv;
  }

  async function ageSeat(
    kv: ReturnType<typeof createMemoryKv>,
    id: string,
    ageMs: number,
  ) {
    const room = roomFromJson((await kv.get(ROOM_KEY))!);
    const seat = room.seats.find((item) => item.id === id);
    assert.ok(seat);
    seat.seen = Date.now() - ageMs;
    await kv.set(ROOM_KEY, roomToJson(room));
  }

  async function saveGame(
    kv: ReturnType<typeof createMemoryKv>,
    edit: (room: ReturnType<typeof roomFromJson>) => void,
  ) {
    const room = roomFromJson((await kv.get(ROOM_KEY))!);
    edit(room);
    await kv.set(ROOM_KEY, roomToJson(room));
    return room;
  }

  test('active seat stays, reload reclaims, one miss does not release, stale frees the color', async () => {
    const kv = memory();
    const joined = await roomCommand({ op: 'join', team: 'you', name: 'Анна' });
    assert.equal(joined.error, undefined);
    const id = joined.playerId!;
    const live = await roomView(id);
    assert.equal(live.you?.team, 'you');
    assert.equal(live.seats?.length, 1);

    const reloaded = await roomCommand({
      op: 'join',
      playerId: id,
      team: 'red',
      name: 'Анна',
    });
    assert.equal(reloaded.playerId, id);
    assert.equal(reloaded.you?.team, 'you');

    await ageSeat(kv, id, 1000);
    const missed = await roomView(null);
    assert.equal(missed.seats?.length, 1);
    assert.equal(missed.seats?.[0].away, undefined);

    await ageSeat(kv, id, SEAT_AWAY_MS + 1000);
    const away = await roomView(null);
    assert.equal(away.seats?.length, 1);
    assert.equal(away.seats?.[0].away, true);
    const blocked = await roomCommand({ op: 'join', team: 'you', name: 'Борис' });
    assert.match(blocked.error || '', /занят/);
    const reclaimed = await roomCommand({
      op: 'join',
      playerId: id,
      team: 'you',
      name: 'Анна',
    });
    assert.equal(reclaimed.playerId, id);

    await ageSeat(kv, id, SEAT_RELEASE_MS + 1000);
    const freed = await roomView(null);
    assert.equal(freed.seats?.length, 0);
    const newbie = await roomCommand({ op: 'join', team: 'you', name: 'Борис' });
    assert.equal(newbie.error, undefined);
    assert.notEqual(newbie.playerId, id);
    const left = await roomCommand({ op: 'leave', playerId: newbie.playerId });
    assert.equal(left.seats?.length, 0);
  });

  test('a stale player id cannot revive itself on reload or join', async () => {
    const kv = memory();
    const joined = await roomCommand({ op: 'join', team: 'you', name: 'Анна' });
    assert.ok(joined.playerId);
    await ageSeat(kv, joined.playerId!, SEAT_RELEASE_MS + 1);

    const reloaded = await roomView(joined.playerId!);
    assert.equal(reloaded.you, null);
    assert.equal(reloaded.seats?.length, 0);

    const secondKv = memory();
    const second = await roomCommand({ op: 'join', team: 'red', name: 'Борис' });
    assert.ok(second.playerId);
    await ageSeat(secondKv, second.playerId!, SEAT_RELEASE_MS + 1);
    const rejoin = await roomCommand({
      op: 'join',
      playerId: second.playerId,
      team: 'red',
      name: 'Борис',
    });
    assert.match(rejoin.error || '', /освобождено/);
    assert.equal(rejoin.seats?.length, 0);
  });

  test('leaving mid-decree cancels an armed spell for that team', async () => {
    const kv = memory();
    const leader = await roomCommand({ op: 'join', team: 'you', name: 'Анна' });
    const ally = await roomCommand({ op: 'join', team: 'red', name: 'Борис' });
    await roomCommand({ op: 'ready', playerId: leader.playerId });
    await roomCommand({ op: 'ready', playerId: ally.playerId });
    await saveGame(kv, (room) => {
      room.startAt = Date.now() - 5;
    });
    await saveGame(kv, (room) => {
      room.paused = true;
      room.game.age = DEVELOPMENT_SECONDS;
      room.game.elapsed = DEVELOPMENT_SECONDS;
      room.game.authority = 'you';
      room.game.authorityEpoch = 2;
      room.game.leaderSince = DEVELOPMENT_SECONDS;
      room.game.wallets.you.earned = 500;
      room.game.spell = {
        team: 'you',
        epoch: 2,
        prompt: 'Тест',
        startedAt: DEVELOPMENT_SECONDS,
        patch: { kind: 'reinforce', target: 'main', amount: 20 },
        castAt: DEVELOPMENT_SECONDS + 12,
        roll: 'disabled',
        nonce: 1,
      };
    });
    const left = await roomCommand({
      op: 'leave',
      playerId: leader.playerId,
    });
    assert.equal(left.error, undefined);
    const saved = roomFromJson((await kv.get(ROOM_KEY))!);
    assert.equal(saved.game.spell, undefined);
    assert.equal(saved.game.humans?.includes('you'), false);
  });

  test('a started match releases a stale seat and does not let a stranger take it', async () => {
    const kv = memory();
    const anna = await roomCommand({ op: 'join', team: 'you', name: 'Анна' });
    const boris = await roomCommand({ op: 'join', team: 'red', name: 'Борис' });
    await roomCommand({ op: 'ready', playerId: anna.playerId });
    await roomCommand({ op: 'ready', playerId: boris.playerId });
    await saveGame(kv, (room) => {
      room.startAt = Date.now() - 5;
    });
    const started = await roomView(boris.playerId!);
    assert.equal(started.started, true);
    await ageSeat(kv, anna.playerId!, 1000);
    const still = await roomView(boris.playerId!);
    assert.equal(still.seats?.some((seat) => seat.team === 'you'), true);
    await ageSeat(kv, anna.playerId!, SEAT_RELEASE_MS + 5000);
    const released = await roomView(boris.playerId!);
    assert.equal(released.started, true);
    assert.equal(released.seats?.some((seat) => seat.team === 'you'), false);
    assert.equal(released.seats?.some((seat) => seat.team === 'red'), true);
    assert.equal(released.game?.humans?.includes('you'), false);
    const stranger = await roomCommand({ op: 'join', team: 'you', name: 'Вор' });
    assert.match(stranger.error || '', /Матч уже идёт/);
    const reclaim = await roomCommand({
      op: 'join',
      playerId: anna.playerId,
      team: 'you',
      name: 'Анна',
    });
    assert.match(reclaim.error || '', /освобождено/);
  });

  test('four seats join, reload, attack, decree, and one team death', async () => {
    const kv = memory();
    const names = [
      ['you', 'Синий'],
      ['red', 'Красный'],
      ['purple', 'Фиолетовый'],
      ['green', 'Зелёный'],
    ] as const;
    const ids: string[] = [];
    for (const [team, name] of names) {
      const joined = await roomCommand({ op: 'join', team, name });
      assert.equal(joined.error, undefined, joined.error);
      ids.push(joined.playerId!);
    }
    for (const id of ids) {
      const ready = await roomCommand({ op: 'ready', playerId: id });
      assert.equal(ready.error, undefined);
    }
    await saveGame(kv, (room) => {
      room.startAt = Date.now() - 5;
    });
    const opened = await roomView(ids[0]);
    assert.equal(opened.started, true);
    assert.equal(opened.seats?.length, 4);

    const reloaded = await roomCommand({
      op: 'join',
      playerId: ids[0],
      team: 'red',
      name: 'Синий',
    });
    assert.equal(reloaded.playerId, ids[0]);
    assert.equal(reloaded.you?.team, 'you');

    const before = roomFromJson((await kv.get(ROOM_KEY))!).game;
    const source = before.towers.find((tower) => tower.home === 'you')!;
    const target = before.towers.find((tower) => !tower.team && tower.kind === 'gold')!;
    const sourceCount = source.count;
    const attack = await roomCommand({
      op: 'action',
      playerId: ids[0],
      action: { type: 'army', from: source.id, to: target.id, fraction: 0.5 },
    });
    assert.equal(attack.error, undefined, attack.error);
    await roomCommand({ op: 'pause', playerId: ids[1], paused: true });
    const attackViews = await Promise.all(ids.map((id) => roomView(id)));
    assert.ok(attackViews.every((view) => view.revision === attackViews[0].revision));
    assert.ok(
      attackViews.every((view) => {
        const tower = view.game?.towers.find((item) => item.id === source.id);
        return (
          (view.game?.troops.length ?? 0) > 0 &&
          (tower?.count ?? sourceCount) < sourceCount
        );
      }),
    );

    await saveGame(kv, (room) => {
      room.paused = false;
      room.clock = Date.now();
      room.game.age = DEVELOPMENT_SECONDS;
      room.game.elapsed = DEVELOPMENT_SECONDS;
      room.game.authority = null;
      room.game.leaderSince = DEVELOPMENT_SECONDS;
      room.game.wallets.you.earned = 900;
      room.game.wallets.red.earned = 1;
      room.game.wallets.purple.earned = 1;
      room.game.wallets.green.earned = 1;
    });
    const spell = await roomCommand({
      op: 'action',
      playerId: ids[0],
      action: { type: 'spell-start', text: 'штабу +20', roll: 'disabled' },
    });
    assert.equal(typeof spell.spellNonce, 'number');
    assert.equal(typeof spell.spellEpoch, 'number');
    const armed = await roomCommand({
      op: 'action',
      playerId: ids[0],
      action: {
        type: 'spell-ready',
        patch: { kind: 'reinforce', target: 'main', amount: 20 },
        epoch: spell.spellEpoch!,
        debuff: null,
        roll: 'disabled',
      },
    });
    assert.equal(armed.error, undefined, armed.error);
    const hqBefore = roomFromJson((await kv.get(ROOM_KEY))!).game.towers.find(
      (tower) => tower.home === 'you',
    )!.count;
    await saveGame(kv, (room) => {
      const castAt = room.game.spell?.castAt ?? room.game.age;
      room.game.age = castAt;
      room.clock = Date.now() - 120;
      room.paused = false;
    });
    const cast = await roomView(ids[0]);
    const hqAfter = cast.game?.towers.find((tower) => tower.home === 'you')!.count ?? 0;
    assert.ok(hqAfter >= hqBefore + 20, `decree ${hqBefore} -> ${hqAfter}`);
    await roomCommand({ op: 'pause', playerId: ids[2], paused: true });
    const decreeViews = await Promise.all(ids.map((id) => roomView(id)));
    assert.ok(decreeViews.every((view) => view.revision === decreeViews[0].revision));
    assert.ok(
      decreeViews.every(
        (view) =>
          (view.game?.towers.find((tower) => tower.home === 'you')?.count ?? 0) >=
          hqBefore + 20,
      ),
    );

    await saveGame(kv, (room) => {
      room.paused = false;
      room.clock = Date.now() - 120;
      room.game.age = DEVELOPMENT_SECONDS;
      room.game.elapsed = DEVELOPMENT_SECONDS;
      room.game.result = null;
      room.game.towers = room.game.towers.map((tower) =>
        tower.team === 'red' || tower.home === 'red'
          ? { ...tower, team: 'red' as const, home: tower.home ? ('red' as const) : tower.home, count: Math.max(tower.count, 8), ruinedAt: undefined }
          : { ...tower, team: null, home: undefined, count: 0, ruinedAt: room.game.age },
      );
    });
    const ended = await roomView(ids[1]);
    assert.equal(ended.game?.result, 'red');
    const endViews = await Promise.all(ids.map((id) => roomView(id)));
    assert.ok(endViews.every((view) => view.game?.result === 'red'));
    assert.ok(endViews.every((view) => view.revision === endViews[0].revision));
  });
});

describe('epoch politics and lobby bans', () => {
  test('lobby chaos ban persists and excludes candidates', async () => {
    const kv = createMemoryKv();
    setRoomKvForTests(kv);
    const a = await roomCommand({
      op: 'join',
      team: 'you',
      name: 'A',
    });
    const b = await roomCommand({
      op: 'join',
      team: 'red',
      name: 'B',
      playerId: crypto.randomUUID(),
    });
    assert.ok(a.playerId && b.playerId);
    await roomCommand({ op: 'ready', playerId: a.playerId });
    const ready = await roomCommand({ op: 'ready', playerId: b.playerId });
    assert.ok(ready.startAt);
    const ban = await roomCommand({
      op: 'chaos-ban',
      playerId: a.playerId,
      kinds: ['chaos_march_speed', 'chaos_hq_shield'],
    });
    assert.equal(ban.error, undefined);
    assert.deepEqual(ban.chaosBans?.you, [
      'chaos_march_speed',
      'chaos_hq_shield',
    ]);
    const filtered = localDecreeCandidates('test', [
      'chaos_march_speed',
      'chaos_hq_shield',
    ]);
    assert.equal(filtered.length, 3);
    const blob = JSON.stringify(filtered);
    assert.ok(!blob.includes('chaos_march_speed'));
    assert.ok(!blob.includes('chaos_hq_shield'));
  });

  test('non-leader veto adds delay once', () => {
    let g = initialGame();
    g.age = DEVELOPMENT_SECONDS + 5;
    g.elapsed = DEVELOPMENT_SECONDS + 5;
    g.humans = ['you', 'red'];
    g.wallets.you.earned = 200;
    g.wallets.red.earned = 50;
    g = refreshAuthority(g);
    g = startSpell(g, g.authority!, 'тест');
    const veto = decreeVeto(g, 'red', 'delay');
    assert.equal(veto.spellVetoDelay, 10);
    assert.equal(veto.teamVetoUsed?.red, true);
    assert.equal(decreeVeto(veto, 'red', 'delay'), veto);
  });

  test('room_busy backoff grows with a cap and stops after max retries', () => {
    assert.equal(isRoomBusy({ status: 503 }, { code: 'room_busy' }), true);
    assert.equal(isRoomBusy({ status: 503 }, { code: 'redis_missing' }), false);
    const a = roomBusyBackoffMs(0);
    const b = roomBusyBackoffMs(3);
    assert.ok(b >= a);
    assert.ok(roomBusyBackoffMs(ROOM_BUSY_MAX_RETRIES) <= 8000);
  });

  test('chaos registry covers every chaos kind', () => {
    assert.equal(registryCoversAllKinds(), true);
  });

  test('resource mines never auto-recruit garrison', () => {
    const g = initialGame();
    assert.equal(assertSymmetricStartWallets(g.wallets), true);
    for (const t of g.towers) {
      if (t.kind === 'gold' || t.kind === 'lumber') {
        assert.equal(production({ ...t, team: 'you' }), 0);
        assert.equal(garrisonRecruitAllowed({ ...t, team: 'you' }), false);
        assert.equal(chaosMineBirthEligible({ ...t, team: 'you' }), false);
      }
    }
  });

  test('chaos mine birth adds count to barracks not gold mines', () => {
    let g = initialGame();
    g.humans = ['you'];
    g.age = DEVELOPMENT_SECONDS;
    g.elapsed = DEVELOPMENT_SECONDS;
    g.wallets.you.earned = 400;
    g = refreshAuthority(g);
    assert.equal(g.authority, 'you');
    const epoch = g.authorityEpoch;
    const mine = g.towers.find((t) => t.kind === 'gold')!;
    mine.team = 'you';
    const barracks = g.towers.find(
      (t) => t.kind === 'barracks' && Math.hypot(t.x - 18, t.y - 20) < 40,
    )!;
    barracks.team = 'you';
    const mineBefore = mine.count;
    const barracksBefore = barracks.count;
    g = applyDecree(
      g,
      'you',
      {
        kind: 'batch',
        actions: [
          { kind: 'chaos_mine_birth', target: 'all', amount: 0, param: 24 },
        ],
      },
      epoch,
      'test',
    );
    assert.equal(
      g.towers.find((t) => t.id === mine.id)!.count,
      mineBefore,
    );
    assert.ok(
      g.towers.find((t) => t.id === barracks.id)!.count > barracksBefore,
    );
  });

  test('heavy role captures neutrals faster than line at equal dispatch', () => {
    const linePower =
      Math.floor(10 * roleMult('line', 'strength')) * roleMult('line', 'capture');
    const heavyPower =
      Math.floor(10 * roleMult('heavy', 'strength')) *
      roleMult('heavy', 'capture');
    assert.ok(heavyPower > linePower);
    const role = pickTroopRole({
      team: 'you',
      from: 0,
      to: 1,
      index: 0,
      sourceKind: 'barracks',
      target: { kind: 'tower', team: null, level: 1 },
    });
    assert.ok(['line', 'heavy', 'scout', 'skirm'].includes(role));
  });

  test('match bootstrap sets mutation and objective', async () => {
    const kv = createMemoryKv();
    setRoomKvForTests(kv);
    const ids: string[] = [];
    for (const team of ['you', 'red'] as const) {
      const joined = await roomCommand({
        op: 'join',
        team,
        name: team,
      });
      assert.ok(joined.playerId);
      ids.push(joined.playerId!);
      await roomCommand({ op: 'ready', playerId: joined.playerId });
    }
    const room = roomFromJson((await kv.get(ROOM_KEY))!);
    room.startAt = Date.now() - 1;
    await kv.set(ROOM_KEY, roomToJson(room));
    const view = await roomView(ids[0]);
    assert.ok(view.game?.mapMutation);
    assert.ok(view.game?.epochObjective);
    assert.ok(view.game?.matchMutator);
  });
});
