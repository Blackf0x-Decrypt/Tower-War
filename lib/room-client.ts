import type { RoomTransport } from './room-protocol';

export const ROOM_BUSY_MAX_RETRIES = 8;
export const ROOM_BUSY_BASE_MS = 120;
export const ROOM_BUSY_CAP_MS = 8_000;

export type RoomErrorBody = { error?: string; code?: string };

export function isRoomBusy(
  response: Pick<Response, 'status'>,
  body: RoomErrorBody,
): boolean {
  return response.status === 503 && body.code === 'room_busy';
}

/** Exponential backoff with jitter for lock contention (503 room_busy). */
export function roomBusyBackoffMs(attempt: number): number {
  const exp = ROOM_BUSY_BASE_MS * 2 ** attempt;
  const jitter = Math.random() * 0.25 * exp;
  return Math.min(ROOM_BUSY_CAP_MS, exp + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchRoomJson<T extends RoomErrorBody>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ response: Response; body: T }> {
  let attempt = 0;
  for (;;) {
    const response = await fetch(input, init);
    const body = (await response.json()) as T;
    if (isRoomBusy(response, body) && attempt < ROOM_BUSY_MAX_RETRIES) {
      await sleep(roomBusyBackoffMs(attempt));
      attempt += 1;
      continue;
    }
    return { response, body };
  }
}

export function buildRoomGetUrl(
  basePath: string,
  opts: { playerId?: string; cursor?: string | null; full?: boolean },
): string {
  const query = new URLSearchParams();
  if (opts.playerId) query.set('player', opts.playerId);
  if (!opts.full && opts.cursor) query.set('cursor', opts.cursor);
  const qs = query.size ? `?${query}` : '';
  return `${basePath}${qs}`;
}
