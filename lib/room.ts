import { applyPlay, type PlayAction } from './play';
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
};

const STALE_MS = 120_000;

export type RoomView = {
  seats?: { name: string; team: Team; ready: boolean }[];
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
};

export function blankRoom(now = Date.now()): Room {
  return {
    seats: [],
    started: false,
    paused: false,
    game: initialGame(),
    clock: now,
    startAt: null,
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
      troops: game.troops.slice(-80),
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
    if (!current.startAt) current.startAt = Date.now() + 3000;
    return;
  }
  current.startAt = null;
}

function launch(current: Room, now: number) {
  if (current.started || !current.startAt || now < current.startAt) return;
  current.game = stampHumans(initialGame(), current.seats);
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

function dropStale(current: Room, now: number) {
  const gone = current.seats.filter((s) => now - s.seen > STALE_MS);
  if (!gone.length) return;
  current.seats = current.seats.filter((s) => now - s.seen <= STALE_MS);
  if (current.started) {
    const left = new Set(gone.map((s) => s.team));
    const spell = current.game.spell;
    current.game = {
      ...current.game,
      humans: (current.game.humans ?? []).filter((t) => !left.has(t)),
      spell: spell && left.has(spell.team) && !spell.patch ? undefined : spell,
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

export function prepare(current: Room, playerId: string | null | undefined, now: number) {
  noteSeen(current, playerId, now);
  advance(current, now);
  dropStale(current, now);
  launch(current, now);
}

function viewOf(current: Room, playerId: string | null): RoomView {
  const seat = current.seats.find((s) => s.id === playerId);
  return {
    seats: current.seats.map(({ name, team, ready }) => ({ name, team, ready })),
    started: current.started,
    paused: current.paused,
    startAt: current.started ? null : current.startAt,
    game: current.started ? current.game : null,
    you: seat ? { team: seat.team, ready: seat.ready } : null,
    clock: current.clock,
  };
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
      const result = fn(room, now);
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
      return viewOf(current, playerId);
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
}): Promise<RoomView> {
  const kv = resolveKv();
  if (kv === 'missing') return missingRoom();
  return editRoom((current, now) => {
    prepare(current, body.playerId, now);
    const op = body.op;
    if (op === 'join') {
      if (current.started)
        return { error: 'Матч уже идёт. Дождитесь конца или сброса.' };
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
      return { ...viewOf(current, seat.id), playerId: seat.id, team: seat.team };
    }
    const seat = current.seats.find((s) => s.id === body.playerId);
    if (!seat) return { error: 'Сначала выберите цвет.' };
    seat.seen = now;
    if (op === 'leave') {
      current.seats = current.seats.filter((s) => s.id !== seat.id);
      if (current.started) {
        const spell = current.game.spell;
        current.game = {
          ...current.game,
          humans: (current.game.humans ?? []).filter((t) => t !== seat.team),
          spell:
            spell && spell.team === seat.team && !spell.patch
              ? undefined
              : spell,
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
      return viewOf(current, null);
    }
    if (op === 'ready') {
      if (!current.started) seat.ready = !seat.ready;
      syncReady(current);
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
