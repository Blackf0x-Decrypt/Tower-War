import type { ChaosEffectKind } from './chaos-rules';
import {
  bootstrapMatch,
  stableRoomSeed,
  unionChaosBans,
  validChaosBanList,
  weeklyMutator,
} from './match-meta';
import { applyPlay, type PlayAction } from './play';
import { diffTowers, diffTroops, type TroopJournal } from './room-protocol';
import { initialGame, tick, TEAM_IDS, type Game, type Team } from './tower-game';
import {
  REDIS_MISSING_ERROR,
  ROOM_KEY,
  RedisRequestError,
  RoomBusyError,
  capJson,
  lockedUpdate,
  resolveKv,
  type Kv,
} from './room-store';

export type Seat = {
  id: string;
  name: string;
  team: Team;
  seen: number;
  ready: boolean;
};

export type Room = {
  seats: Seat[];
  started: boolean;
  paused: boolean;
  game: Game;
  clock: number;
  startAt: number | null;
  revision: number;
  troopJournal?: TroopJournal;
  matchSeed?: number;
  chaosBans?: Partial<Record<Team, ChaosEffectKind[]>>;
};

export const SEAT_AWAY_MS = 20_000;
export const SEAT_RELEASE_MS = 180_000;

export type RoomView = {
  seats?: { name: string; team: Team; ready: boolean; away?: boolean }[];
  started?: boolean;
  paused?: boolean;
  startAt?: number | null;
  game?: Game | null;
  you?: { team: Team; ready: boolean } | null;
  error?: string;
  code?: 'redis_missing';
  playerId?: string;
  team?: Team;
  ok?: boolean;
  spellNonce?: number | null;
  spellEpoch?: number | null;
  clock?: number;
  revision?: number;
  troopJournal?: TroopJournal;
  chaosBans?: Partial<Record<Team, ChaosEffectKind[]>>;
  mutatorBanner?: string;
};

export function blankRoom(now = Date.now()): Room {
  return {
    seats: [],
    started: false,
    paused: false,
    game: initialGame(),
    clock: now,
    startAt: null,
    revision: 0,
  };
}

function capStored(parsed: unknown): unknown {
  const room = parsed as Room;
  const game = room?.game;
  if (!game) return parsed;
  return {
    ...room,
    game: {
      ...game,
      shots: game.shots?.slice(-8),
      explosions: game.explosions?.slice(-8),
      notice: String(game.notice || '').slice(0, 160),
    },
  };
}

export function roomToJson(room: Room): string {
  const game = { ...room.game };
  if (game.shots && game.shots.length > 40) game.shots = game.shots.slice(-40);
  if (game.explosions && game.explosions.length > 16)
    game.explosions = game.explosions.slice(-16);
  if (game.curses && game.curses.length > 12) game.curses = game.curses.slice(-12);
  if (game.decreeLog && game.decreeLog.length > 8)
    game.decreeLog = game.decreeLog.slice(-8);
  if (game.decreeChronicle && game.decreeChronicle.length > 5)
    game.decreeChronicle = game.decreeChronicle.slice(0, 5);
  return capJson(JSON.stringify({ ...room, game }), capStored);
}

export function roomFromJson(raw: string): Room {
  const data = JSON.parse(raw) as Room;
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray(data.seats) ||
    typeof data.started !== 'boolean' ||
    typeof data.paused !== 'boolean' ||
    !data.game ||
    typeof data.game !== 'object' ||
    !Array.isArray(data.game.towers) ||
    !Number.isFinite(data.clock)
  ) {
    throw new Error('bad room json');
  }
  if (data.startAt != null && !Number.isFinite(data.startAt)) data.startAt = null;
  if (!Number.isSafeInteger(data.revision) || data.revision < 0) data.revision = 0;
  const journal = data.troopJournal;
  if (
    journal &&
    (!Number.isSafeInteger(journal.from) ||
      journal.from < 0 ||
      !Array.isArray(journal.ops))
  )
    delete data.troopJournal;
  return data;
}

function advance(current: Room, now: number) {
  if (!Number.isFinite(current.clock)) current.clock = now;
  if (!current.started || current.paused || current.game.result) {
    current.clock = now;
    return;
  }
  const elapsed = Math.min(0.45, (now - current.clock) / 1000);
  current.clock = now;
  const steps = Math.min(8, Math.floor((elapsed + 1e-8) / 0.05));
  for (let i = 0; i < steps; i++) current.game = tick(current.game, 0.05);
}

function stampHumans(g: Game, seats: Seat[]) {
  g.humans = seats.map((s) => s.team);
  g.players = Object.fromEntries(seats.map((s) => [s.team, s.name]));
  g.towers = g.towers.map((t) =>
    t.home && g.players?.[t.home]
      ? { ...t, name: `Штаб · ${g.players[t.home]}` }
      : t,
  );
  return g;
}

function syncReady(current: Room) {
  if (current.started) return;
  const allReady =
    current.seats.length >= 2 && current.seats.every((s) => s.ready);
  if (allReady) {
    if (!current.startAt) current.startAt = Date.now() + 33_000;
    return;
  }
  current.startAt = null;
}

function launch(current: Room, now: number) {
  if (current.started || !current.startAt || now < current.startAt) return;
  const seed =
    current.matchSeed ??
    stableRoomSeed(current.seats.map((s) => s.id).sort());
  current.matchSeed = seed;
  const humans = current.seats.map((s) => s.team);
  const banned = unionChaosBans(current.chaosBans, humans);
  const mutator = weeklyMutator(now);
  let game = stampHumans(initialGame(), current.seats);
  game = bootstrapMatch(game, seed, banned, mutator);
  current.game = game;
  current.started = true;
  current.paused = false;
  current.clock = now;
  current.startAt = null;
  for (const seat of current.seats) seat.ready = false;
}

function noteSeen(current: Room, playerId: string | null | undefined, now: number) {
  if (!playerId) return;
  const seat = current.seats.find((s) => s.id === playerId);
  if (seat) seat.seen = now;
}

function releaseSeat(current: Room, seat: Seat, now: number) {
  current.seats = current.seats.filter((s) => s.id !== seat.id);
  if (current.started) {
    const spell = current.game.spell;
    current.game = {
      ...current.game,
      humans: (current.game.humans ?? []).filter((t) => t !== seat.team),
      spell: spell && spell.team === seat.team ? undefined : spell,
    };
  }
  if (!current.seats.length) {
    current.started = false;
    current.paused = false;
    current.game = initialGame();
    current.clock = now;
    current.startAt = null;
  }
  syncReady(current);
}

function dropStale(current: Room, now: number) {
  const gone = current.seats.filter((s) => now - s.seen > SEAT_RELEASE_MS);
  for (const seat of gone) releaseSeat(current, seat, now);
}

export function prepare(
  current: Room,
  playerId: string | null | undefined,
  now: number,
) {
  advance(current, now);
  const released = !!playerId && current.seats.some(
    (seat) => seat.id === playerId && now - seat.seen > SEAT_RELEASE_MS,
  );
  dropStale(current, now);
  noteSeen(current, playerId, now);
  launch(current, now);
  return released;
}

function viewOf(current: Room, playerId: string | null, now = Date.now()): RoomView {
  const seat = current.seats.find((s) => s.id === playerId);
  return {
    seats: current.seats.map(({ name, team, ready, seen }) => ({
      name,
      team,
      ready,
      ...(now - seen > SEAT_AWAY_MS ? { away: true } : {}),
    })),
    started: current.started,
    paused: current.paused,
    startAt: current.started ? null : current.startAt,
    game: current.started ? current.game : null,
    you: seat ? { team: seat.team, ready: seat.ready } : null,
    clock: current.clock,
    revision: current.revision,
    troopJournal: current.troopJournal,
    chaosBans: current.chaosBans,
    mutatorBanner: weeklyMutator(now).label,
  };
}

function publicState(room: Room) {
  return JSON.stringify({
    seats: room.seats.map(({ name, team, ready }) => ({ name, team, ready })),
    started: room.started,
    paused: room.paused,
    startAt: room.startAt,
    game: room.started ? room.game : null,
  });
}

function missingRoom(): RoomView {
  return { error: REDIS_MISSING_ERROR, code: 'redis_missing' };
}

async function editRoom<T>(
  fn: (room: Room, now: number) => T,
  attempts?: number,
): Promise<T> {
  const kv = resolveKv();
  if (kv === 'missing') throw new RedisRequestError(0, 'redis env missing');
  return lockedUpdate(
    kv,
    ROOM_KEY,
    (raw) => {
      const now = Date.now();
      const room = raw ? roomFromJson(raw) : blankRoom(now);
      const beforeTroops = room.game.troops;
      const beforeTowers = room.game.towers;
      const beforeRevision = room.revision;
      const before = publicState(room);
      const result = fn(room, now);
      if (publicState(room) !== before) {
        room.revision = beforeRevision + 1;
        const troops = diffTroops(
          beforeTroops,
          room.started ? room.game.troops : [],
        );
        room.troopJournal = {
          from: beforeRevision,
          ops: troops.ops,
          ...(troops.order ? { order: troops.order } : {}),
          towers: diffTowers(beforeTowers, room.started ? room.game.towers : beforeTowers),
        };
      }
      if (result && typeof result === 'object') {
        const view = result as RoomView;
        if ('revision' in view) view.revision = room.revision;
        if (Array.isArray(view.seats)) view.troopJournal = room.troopJournal;
      }
      return { json: roomToJson(room), result };
    },
    attempts,
  );
}

function storedView(kv: Kv, playerId: string | null): Promise<RoomView> {
  return kv.get(ROOM_KEY).then((raw) => {
    return viewOf(raw ? roomFromJson(raw) : blankRoom(), playerId);
  });
}

export async function roomView(playerId: string | null): Promise<RoomView> {
  const kv = resolveKv();
  if (kv === 'missing') return missingRoom();
  try {
    return await editRoom((current, now) => {
      prepare(current, playerId, now);
      return viewOf(current, playerId, now);
    }, 1);
  } catch (error) {
    if (!(error instanceof RoomBusyError)) throw error;
    return storedView(kv, playerId);
  }
}

function isTeam(value: unknown): value is Team {
  return TEAM_IDS.includes(value as Team);
}

export async function roomCommand(body: {
  op?: string;
  playerId?: string;
  team?: string;
  name?: string;
  action?: PlayAction;
  paused?: boolean;
  kinds?: unknown;
}): Promise<RoomView> {
  const kv = resolveKv();
  if (kv === 'missing') return missingRoom();
  return editRoom((current, now) => {
    const released = prepare(current, body.playerId, now);
    const op = body.op;
    if (op === 'join') {
      if (body.playerId && released)
        return {
          ...viewOf(current, null, now),
          error: 'Место освобождено: связи не было больше 3 минут.',
        };
      if (body.playerId) {
        const existing = current.seats.find((s) => s.id === body.playerId);
        if (existing) {
          existing.seen = now;
          const name = String(body.name || '').trim().slice(0, 16);
          if (name) existing.name = name;
          return {
            ...viewOf(current, existing.id, now),
            playerId: existing.id,
            team: existing.team,
          };
        }
      }
      if (current.started)
        return {
          error: body.playerId
            ? 'Место освобождено: связи не было больше 3 минут.'
            : 'Матч уже идёт. Дождитесь конца или сброса.',
        };
      if (!isTeam(body.team)) return { error: 'Нет такого цвета.' };
      if (current.seats.some((s) => s.team === body.team))
        return { error: 'Этот цвет уже занят.' };
      const name = String(body.name || 'Игрок').trim().slice(0, 16) || 'Игрок';
      const seat: Seat = {
        id: crypto.randomUUID(),
        name,
        team: body.team,
        seen: now,
        ready: false,
      };
      current.seats.push(seat);
      syncReady(current);
      return { ...viewOf(current, seat.id, now), playerId: seat.id, team: seat.team };
    }
    const seat = current.seats.find((s) => s.id === body.playerId);
    if (!seat) return { error: 'Сначала выберите цвет.' };
    seat.seen = now;
    if (op === 'leave') {
      releaseSeat(current, seat, now);
      return viewOf(current, null, now);
    }
    if (op === 'ready') {
      if (!current.started) seat.ready = !seat.ready;
      syncReady(current);
      return viewOf(current, seat.id);
    }
    if (op === 'chaos-ban') {
      if (current.started)
        return { error: 'Бан хаоса только до старта матча.', ...viewOf(current, seat.id) };
      if (!current.startAt || now >= current.startAt - 3000)
        return {
          error: 'Окно бана закрыто (последние 3 с перед стартом).',
          ...viewOf(current, seat.id),
        };
      if (!validChaosBanList(body.kinds))
        return {
          error: 'Выберите до двух разных типов хаоса.',
          ...viewOf(current, seat.id),
        };
      current.chaosBans = {
        ...(current.chaosBans ?? {}),
        [seat.team]: body.kinds as ChaosEffectKind[],
      };
      return viewOf(current, seat.id);
    }
    if (op === 'pause') {
      if (
        current.started &&
        !current.game.result &&
        typeof body.paused === 'boolean'
      )
        current.paused = body.paused;
      return viewOf(current, seat.id);
    }
    if (op === 'reset') {
      if (current.started && !current.game.result)
        return { error: 'Матч ещё идёт.', ...viewOf(current, seat.id) };
      current.started = false;
      current.paused = false;
      current.game = initialGame();
      current.clock = now;
      current.startAt = null;
      current.chaosBans = {};
      current.matchSeed = undefined;
      for (const s of current.seats) s.ready = false;
      return viewOf(current, seat.id);
    }
    if (op === 'action') {
      if (
        !current.started ||
        current.paused ||
        current.game.result ||
        !body.action ||
        typeof body.action !== 'object'
      )
        return viewOf(current, seat.id);
      current.game = applyPlay(current.game, seat.team, body.action);
      return {
        ...viewOf(current, seat.id),
        ok: true,
        spellNonce: current.game.spell?.nonce ?? null,
        spellEpoch: current.game.spell?.epoch ?? null,
      };
    }
    return { error: 'Неизвестная команда.' };
  });
}

export async function lockedRoomStep(
  kv: Kv,
  playerId: string | null,
  now: number,
): Promise<Room> {
  await lockedUpdate(kv, ROOM_KEY, (raw) => {
    const room = raw ? roomFromJson(raw) : blankRoom(now);
    prepare(room, playerId, now);
    return { json: roomToJson(room), result: null };
  });
  const saved = await kv.get(ROOM_KEY);
  if (!saved) throw new Error('room missing after lock');
  return roomFromJson(saved);
}
