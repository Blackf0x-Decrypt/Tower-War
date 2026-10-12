import type { RoomTransport } from './room-protocol';

export const ROOM_BOOTSTRAP_TIMEOUT_MS = 10_000;

export type RoomBootstrapState = 'idle' | 'loading' | 'error';

export type RoomBootstrapEvent =
  | { type: 'start' }
  | { type: 'complete' }
  | { type: 'released' }
  | { type: 'failure'; message: string };

export function roomBootstrapReducer(
  state: RoomBootstrapState,
  event: RoomBootstrapEvent,
): RoomBootstrapState {
  switch (event.type) {
    case 'start':
      return 'loading';
    case 'complete':
    case 'released':
      return 'idle';
    case 'failure':
      return 'error';
  }
}

export function safeRoomError(
  data: { error?: unknown; code?: unknown } | null | undefined,
  fallback = 'Комната временно недоступна. Попробуйте ещё раз.',
) {
  if (
    typeof data?.error === 'string' &&
    data.error.length > 0 &&
    data.error.length <= 180
  )
    return data.error;
  return fallback;
}

export function needsFullBootstrapRetry(
  message: RoomTransport,
  applied: unknown,
): boolean {
  return (
    !applied &&
    (message.transport === 'delta' || message.transport === 'noop')
  );
}
