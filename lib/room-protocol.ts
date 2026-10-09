import type { Game, Team, Tower, Troop } from './tower-game';
import type { RoomView } from './room';

export const ROOM_PROTOCOL_VERSION = 2;

type LobbyState = {
  seats: { name: string; team: Team; ready: boolean }[];
  started: boolean;
  paused: boolean;
  startAt: number | null;
  you: { team: Team; ready: boolean } | null;
};

type CursorData = {
  v: number;
  r: number;
  l: string;
  g: Record<string, string>;
};

export type TroopWire = [
  id: number,
  team: Team,
  from: number,
  to: number,
  x: number,
  y: number,
  sx: number,
  sy: number,
  progress: number,
  delay: number,
  speech: string,
  cargo: 0 | 1,
  strength: number,
  elite: 0 | 1 | null,
  scoutUntil: number | null,
  waypointX: number | null,
  waypointY: number | null,
  haulGold: number | null,
  haulResources: number | null,
  stolenAt: number | null,
];

export type TroopOp =
  | ['d', number]
  | ['m', number, number, number, number, number]
  | ['s', TroopWire]
  | ['u', TroopWire];

export type TroopDelta = {
  ops: TroopOp[];
  order?: number[];
};

export type TroopJournal = {
  from: number;
  ops: TroopOp[];
  order?: number[];
  towers?: Tower[];
};

export type GameDelta = Partial<Omit<Game, 'troops' | 'towers'>> & {
  troops?: TroopDelta;
  towerPatch?: Tower[];
};

export type RoomFull = LobbyState & {
  transport: 'full';
  protocol: typeof ROOM_PROTOCOL_VERSION;
  revision: number;
  cursor: string;
  game: Game | null;
};

export type RoomDelta = {
  transport: 'delta';
  protocol: typeof ROOM_PROTOCOL_VERSION;
  revision: number;
  base: string;
  cursor: string;
  lobby?: Partial<LobbyState>;
  game?: GameDelta | null;
  gameDelete?: (keyof Game)[];
};

export type RoomNoChange = {
  transport: 'noop';
  protocol: typeof ROOM_PROTOCOL_VERSION;
  revision: number;
};

export type RoomTransport = RoomFull | RoomDelta | RoomNoChange;

export type AppliedRoom = LobbyState & {
  revision: number;
  cursor: string;
  game: Game | null;
};

const MOTION_INDEX = new Set([4, 5, 8, 9]);

function hash(value: unknown): string {
  const json = JSON.stringify(value ?? null) ?? 'null';
  let result = 2166136261;
  for (let i = 0; i < json.length; i++) {
    result ^= json.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function encodeCursor(data: CursorData): string {
  return btoa(JSON.stringify(data))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function decodeCursor(value: string | null | undefined): CursorData | null {
  if (!value || value.length > 4096) return null;
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const parsed = JSON.parse(atob(base64)) as CursorData;
    if (
      parsed.v !== ROOM_PROTOCOL_VERSION ||
      !Number.isSafeInteger(parsed.r) ||
      typeof parsed.l !== 'string' ||
      !parsed.g ||
      typeof parsed.g !== 'object'
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function lobbyOf(view: RoomView): LobbyState {
  return {
    seats: view.seats ?? [],
    started: !!view.started,
    paused: !!view.paused,
    startAt: view.startAt ?? null,
    you: view.you ?? null,
  };
}

export function towerCursorValue(tower: Tower) {
  return {
    id: tower.id,
    team: tower.team,
    count: Math.floor(tower.count),
    level: tower.level,
    kind: tower.kind,
    x: tower.x,
    y: tower.y,
    home: tower.home ?? null,
    name: tower.name,
    gunLevel: tower.gunLevel ?? null,
    specialty: tower.specialty ?? null,
    ruinedAt: tower.ruinedAt ?? null,
  };
}

function gameHashes(game: Game | null): Record<string, string> {
  if (!game) return {};
  return Object.fromEntries(
    Object.entries(game).map(([key, value]) => [
      key,
      hash(key === 'towers' ? (value as Tower[]).map(towerCursorValue) : value),
    ]),
  );
}

function cursorFor(view: RoomView): { data: CursorData; value: string } {
  const data: CursorData = {
    v: ROOM_PROTOCOL_VERSION,
    r: view.revision ?? 0,
    l: hash(lobbyOf(view)),
    g: gameHashes(view.game ?? null),
  };
  return { data, value: encodeCursor(data) };
}

export function packTroop(troop: Troop): TroopWire {
  return [
    troop.id,
    troop.team,
    troop.from,
    troop.to,
    troop.x,
    troop.y,
    troop.sx,
    troop.sy,
    troop.progress,
    troop.delay,
    troop.speech,
    troop.cargo ? 1 : 0,
    troop.strength,
    troop.elite == null ? null : troop.elite ? 1 : 0,
    troop.scoutUntil ?? null,
    troop.waypoint?.x ?? null,
    troop.waypoint?.y ?? null,
    troop.haul?.gold ?? null,
    troop.haul?.resources ?? null,
    troop.stolenAt ?? null,
  ];
}

export function unpackTroop(wire: TroopWire): Troop {
  const troop: Troop = {
    id: wire[0],
    team: wire[1],
    from: wire[2],
    to: wire[3],
    x: wire[4],
    y: wire[5],
    sx: wire[6],
    sy: wire[7],
    progress: wire[8],
    delay: wire[9],
    speech: wire[10],
    cargo: wire[11] === 1,
    strength: wire[12],
  };
  if (wire[13] != null) troop.elite = wire[13] === 1;
  if (wire[14] != null) troop.scoutUntil = wire[14];
  if (wire[15] != null && wire[16] != null)
    troop.waypoint = { x: wire[15], y: wire[16] };
  if (wire[17] != null && wire[18] != null)
    troop.haul = { gold: wire[17], resources: wire[18] };
  if (wire[19] != null) troop.stolenAt = wire[19];
  return troop;
}

function wireEqual(a: TroopWire, b: TroopWire) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function motionOnly(a: TroopWire, b: TroopWire) {
  for (let i = 0; i < a.length; i++) {
    if (MOTION_INDEX.has(i)) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function applyTroopOps(troops: Troop[], delta: TroopDelta): Troop[] {
  const despawn = new Set<number>();
  const moves = new Map<number, ['m', number, number, number, number, number]>();
  const replace = new Map<number, Troop>();
  const spawned: Troop[] = [];
  for (const op of delta.ops) {
    if (op[0] === 'd') despawn.add(op[1]);
    else if (op[0] === 'm') moves.set(op[1], op);
    else if (op[0] === 'u') replace.set(op[1][0], unpackTroop(op[1]));
    else spawned.push(unpackTroop(op[1]));
  }
  const next: Troop[] = [];
  const seen = new Set<number>();
  for (const troop of troops) {
    if (despawn.has(troop.id)) continue;
    seen.add(troop.id);
    const updated = replace.get(troop.id);
    if (updated) {
      next.push(updated);
      continue;
    }
    const move = moves.get(troop.id);
    if (move) {
      next.push({
        ...troop,
        x: move[2],
        y: move[3],
        progress: move[4],
        delay: move[5],
      });
      continue;
    }
    next.push(troop);
  }
  for (const troop of spawned) {
    if (seen.has(troop.id)) continue;
    seen.add(troop.id);
    next.push(troop);
  }
  for (const [id, troop] of replace) {
    if (!seen.has(id)) next.push(troop);
  }
  if (!delta.order) return next;
  const byId = new Map(next.map((troop) => [troop.id, troop]));
  const ordered: Troop[] = [];
  for (const id of delta.order) {
    const troop = byId.get(id);
    if (troop) ordered.push(troop);
  }
  return ordered;
}

export function diffTroops(before: Troop[], after: Troop[]): TroopDelta {
  const previous = new Map<number, Troop>();
  for (const troop of before) if (!previous.has(troop.id)) previous.set(troop.id, troop);
  const ops: TroopOp[] = [];
  const kept = new Set<number>();
  for (const troop of after) {
    if (kept.has(troop.id)) continue;
    kept.add(troop.id);
    const old = previous.get(troop.id);
    if (!old) {
      ops.push(['s', packTroop(troop)]);
      continue;
    }
    const left = packTroop(old);
    const right = packTroop(troop);
    if (wireEqual(left, right)) continue;
    if (motionOnly(left, right))
      ops.push(['m', troop.id, troop.x, troop.y, troop.progress, troop.delay]);
    else ops.push(['u', right]);
  }
  for (const troop of before) if (!kept.has(troop.id)) ops.push(['d', troop.id]);
  const delta: TroopDelta = { ops };
  const natural = applyTroopOps(before, delta).map((troop) => troop.id);
  const actual = after.map((troop) => troop.id);
  if (natural.length !== actual.length || natural.some((id, index) => id !== actual[index]))
    delta.order = actual;
  return delta;
}

export function diffTowers(before: Tower[], after: Tower[]): Tower[] | undefined {
  if (before.length !== after.length) return after;
  const changed: Tower[] = [];
  for (let i = 0; i < after.length; i++) {
    if (hash(towerCursorValue(before[i] ?? after[i])) !== hash(towerCursorValue(after[i])))
      changed.push(after[i]);
    else if ((before[i]?.id ?? -1) !== after[i].id) changed.push(after[i]);
  }
  return changed.length ? changed : undefined;
}

export function mergeTowers(prev: Tower[], changed: Tower[]): Tower[] {
  const byId = new Map(changed.map((tower) => [tower.id, tower]));
  let dirty = false;
  const next = prev.map((tower) => {
    const replacement = byId.get(tower.id);
    if (!replacement || replacement === tower) return tower;
    dirty = true;
    return replacement;
  });
  for (const tower of changed) {
    if (!prev.some((item) => item.id === tower.id)) {
      next.push(tower);
      dirty = true;
    }
  }
  return dirty ? next : prev;
}

export function payloadBytes(message: unknown) {
  return new TextEncoder().encode(JSON.stringify(message)).length;
}

function fullTransport(
  view: RoomView,
  lobby: LobbyState,
  game: Game | null,
  revision: number,
  cursor: string,
): RoomFull {
  return {
    transport: 'full',
    protocol: ROOM_PROTOCOL_VERSION,
    revision,
    cursor,
    ...lobby,
    game,
  };
}

export function makeRoomTransport(
  view: RoomView,
  clientCursor?: string | null,
): RoomTransport {
  const current = cursorFor(view);
  const previous = decodeCursor(clientCursor);
  const revision = view.revision ?? 0;
  const lobby = lobbyOf(view);
  const game = view.game ?? null;
  const journal = view.troopJournal;

  if (!previous) return fullTransport(view, lobby, game, revision, current.value);

  if (clientCursor === current.value) {
    return {
      transport: 'noop',
      protocol: ROOM_PROTOCOL_VERSION,
      revision,
    };
  }

  if (previous.r !== revision && revision !== previous.r + 1)
    return fullTransport(view, lobby, game, revision, current.value);
  const contiguous = !!journal && journal.from === previous.r;

  const response: RoomDelta = {
    transport: 'delta',
    protocol: ROOM_PROTOCOL_VERSION,
    revision,
    base: clientCursor!,
    cursor: current.value,
  };
  if (previous.l !== current.data.l) response.lobby = lobby;

  if (!game) {
    if (Object.keys(previous.g).length) response.game = null;
    return response;
  }
  if (!Object.keys(previous.g).length)
    return fullTransport(view, lobby, game, revision, current.value);

  const patch: GameDelta = {};
  for (const [key, value] of Object.entries(game)) {
    if (previous.g[key] === current.data.g[key]) continue;
    if (key === 'troops' || key === 'towers') {
      if (!contiguous) return fullTransport(view, lobby, game, revision, current.value);
      if (key === 'troops')
        patch.troops = {
          ops: journal!.ops,
          ...(journal!.order ? { order: journal!.order } : {}),
        };
      else if (journal!.towers?.length) patch.towerPatch = journal!.towers;
      else return fullTransport(view, lobby, game, revision, current.value);
      continue;
    }
    (patch as Record<string, unknown>)[key] = value;
  }
  const deleted = Object.keys(previous.g).filter(
    (key) => !(key in current.data.g),
  ) as (keyof Game)[];
  if (deleted.length) response.gameDelete = deleted;
  response.game = patch;
  return response;
}

export function applyRoomTransport(
  current: AppliedRoom | null,
  message: RoomTransport,
): AppliedRoom | null {
  if (message.protocol !== ROOM_PROTOCOL_VERSION) return null;
  if (message.transport === 'full') {
    return {
      seats: message.seats,
      started: message.started,
      paused: message.paused,
      startAt: message.startAt,
      you: message.you,
      game: message.game,
      revision: message.revision,
      cursor: message.cursor,
    };
  }
  if (message.transport === 'noop') {
    if (!current || message.revision !== current.revision) return null;
    return current;
  }
  if (!current || message.base !== current.cursor) return null;

  const lobby = message.lobby ? { ...current, ...message.lobby } : current;
  let game = current.game;
  if (message.game === null) game = null;
  else if (message.game) {
    if (!game) return null;
    const { troops, towerPatch, ...patch } = message.game;
    game = { ...game, ...patch };
    if (towerPatch?.length) game = { ...game, towers: mergeTowers(game.towers, towerPatch) };
    if (troops) game = { ...game, troops: applyTroopOps(game.troops, troops) };
    if (message.gameDelete?.length) {
      game = { ...game };
      for (const key of message.gameDelete) delete game[key];
    }
  }
  return {
    seats: lobby.seats,
    started: lobby.started,
    paused: lobby.paused,
    startAt: lobby.startAt,
    you: lobby.you,
    game,
    revision: message.revision,
    cursor: message.cursor,
  };
}
