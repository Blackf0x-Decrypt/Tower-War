import { applyPlay, type PlayAction } from './play';
import { initialGame, tick, TEAM_IDS, type Game, type Team } from './tower-game';

export type Seat = {
  id: string;
  name: string;
  team: Team;
  seen: number;
  ready: boolean;
};

type Room = {
  seats: Seat[];
  started: boolean;
  paused: boolean;
  game: Game;
  clock: number;
  startAt: number | null;
};

const STALE_MS = 120_000;

const globalState = globalThis as typeof globalThis & {
  __towerRoom?: Room;
};

function room(): Room {
  if (!globalState.__towerRoom) {
    globalState.__towerRoom = {
      seats: [],
      started: false,
      paused: false,
      game: initialGame(),
      clock: Date.now(),
      startAt: null,
    };
  }
  return globalState.__towerRoom;
}

function advance(current: Room) {
  const now = Date.now();
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

function launch(current: Room) {
  if (current.started || !current.startAt || Date.now() < current.startAt)
    return;
  current.game = stampHumans(initialGame(), current.seats);
  current.started = true;
  current.paused = false;
  current.clock = Date.now();
  current.startAt = null;
  for (const seat of current.seats) seat.ready = false;
}

function noteSeen(current: Room, playerId: string | null | undefined) {
  if (!playerId) return;
  const seat = current.seats.find((s) => s.id === playerId);
  if (seat) seat.seen = Date.now();
}

function dropStale(current: Room) {
  const now = Date.now();
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
    current.clock = Date.now();
    current.startAt = null;
  }
  syncReady(current);
}

export function roomView(playerId: string | null) {
  const current = room();
  noteSeen(current, playerId);
  advance(current);
  dropStale(current);
  launch(current);
  const seat = current.seats.find((s) => s.id === playerId);
  return {
    seats: current.seats.map(({ name, team, ready }) => ({ name, team, ready })),
    started: current.started,
    paused: current.paused,
    startAt: current.started ? null : current.startAt,
    game: current.started ? current.game : null,
    you: seat ? { team: seat.team, ready: seat.ready } : null,
  };
}

function isTeam(value: unknown): value is Team {
  return TEAM_IDS.includes(value as Team);
}

export function roomCommand(body: {
  op?: string;
  playerId?: string;
  team?: string;
  name?: string;
  action?: PlayAction;
  paused?: boolean;
}) {
  const current = room();
  noteSeen(current, body.playerId);
  advance(current);
  dropStale(current);
  launch(current);
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
      seen: Date.now(),
      ready: false,
    };
    current.seats.push(seat);
    syncReady(current);
    return { ...roomView(seat.id), playerId: seat.id, team: seat.team };
  }
  const seat = current.seats.find((s) => s.id === body.playerId);
  if (!seat) return { error: 'Сначала выберите цвет.' };
  seat.seen = Date.now();
  if (op === 'leave') {
    current.seats = current.seats.filter((s) => s.id !== seat.id);
    if (current.started) {
      const spell = current.game.spell;
      current.game = {
        ...current.game,
        humans: (current.game.humans ?? []).filter((t) => t !== seat.team),
        spell:
          spell && spell.team === seat.team && !spell.patch ? undefined : spell,
      };
    }
    if (!current.seats.length) {
      current.started = false;
      current.paused = false;
      current.game = initialGame();
      current.clock = Date.now();
      current.startAt = null;
    }
    syncReady(current);
    return roomView(null);
  }
  if (op === 'ready') {
    if (!current.started) seat.ready = !seat.ready;
    syncReady(current);
    return roomView(seat.id);
  }
  if (op === 'pause') {
    if (
      current.started &&
      !current.game.result &&
      typeof body.paused === 'boolean'
    )
      current.paused = body.paused;
    return roomView(seat.id);
  }
  if (op === 'reset') {
    if (current.started && !current.game.result)
      return { error: 'Матч ещё идёт.', ...roomView(seat.id) };
    current.started = false;
    current.paused = false;
    current.game = initialGame();
    current.clock = Date.now();
    current.startAt = null;
    for (const s of current.seats) s.ready = false;
    return roomView(seat.id);
  }
  if (op === 'action') {
    if (
      !current.started ||
      current.paused ||
      current.game.result ||
      !body.action ||
      typeof body.action !== 'object'
    )
      return roomView(seat.id);
    current.game = applyPlay(current.game, seat.team, body.action);
    return {
      ok: true,
      spellNonce: current.game.spell?.nonce ?? null,
      spellEpoch: current.game.spell?.epoch ?? null,
    };
  }
  return { error: 'Неизвестная команда.' };
}
