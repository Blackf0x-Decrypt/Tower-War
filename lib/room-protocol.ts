import type { Game, Team, Troop } from './tower-game';
import type { RoomView } from './room';

export const ROOM_PROTOCOL_VERSION = 1;

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

export type GameDelta = Partial<Omit<Game, 'troops'>> & {
  troops?: TroopWire[];
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

function hash(value: unknown): string {
  const json = JSON.stringify(value);
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

function gameHashes(game: Game | null): Record<string, string> {
  if (!game) return {};
  return Object.fromEntries(
    Object.entries(game).map(([key, value]) => [key, hash(value)]),
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

export function makeRoomTransport(
  view: RoomView,
  clientCursor?: string | null,
): RoomTransport {
  const current = cursorFor(view);
  const previous = decodeCursor(clientCursor);
  const revision = view.revision ?? 0;
  const lobby = lobbyOf(view);
  const game = view.game ?? null;

  if (!previous) {
    return {
      transport: 'full',
      protocol: ROOM_PROTOCOL_VERSION,
      revision,
      cursor: current.value,
      ...lobby,
      game,
    };
  }

  if (clientCursor === current.value) {
    return {
      transport: 'noop',
      protocol: ROOM_PROTOCOL_VERSION,
      revision,
    };
  }

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
  if (!Object.keys(previous.g).length) {
    return {
      transport: 'full',
      protocol: ROOM_PROTOCOL_VERSION,
      revision,
      cursor: current.value,
      ...lobby,
      game,
    };
  }

  const patch: GameDelta = {};
  for (const [key, value] of Object.entries(game)) {
    if (previous.g[key] === current.data.g[key]) continue;
    if (key === 'troops')
      patch.troops = game.troops.map(packTroop);
    else (patch as Record<string, unknown>)[key] = value;
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
    const { troops, ...patch } = message.game;
    game = {
      ...game,
      ...patch,
      ...(troops ? { troops: troops.map(unpackTroop) } : {}),
    };
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
