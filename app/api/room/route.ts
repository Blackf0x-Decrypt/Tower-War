import { REDIS_MISSING_ERROR, RedisRequestError, RoomBusyError } from '@/lib/room-store';
import { roomCommand, roomView, type RoomView } from '@/lib/room';
import { makeRoomTransport } from '@/lib/room-protocol';

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function statusFor(result: RoomView) {
  if (result.code === 'redis_missing') return 503;
  if (result.error && !('seats' in result)) return 400;
  return 200;
}

function failure(error: unknown) {
  if (error instanceof RoomBusyError) {
    console.error('room busy');
    return json({ error: error.message, code: 'room_busy' }, 503);
  }
  if (error instanceof RedisRequestError) {
    if (error.reason === 'redis env missing') {
      console.error('room redis missing');
      return json({ error: REDIS_MISSING_ERROR, code: 'redis_missing' }, 503);
    }
    console.error(`room redis ${error.status} ${error.reason}`);
    return json(
      {
        error: 'Redis не ответил. Общая комната недоступна.',
        code: 'redis_error',
        status: error.status,
        reason: error.reason,
      },
      503,
    );
  }
  console.error('room failed');
  return json(
    {
      error: 'Комната временно недоступна. Обновите страницу.',
      code: 'room_error',
    },
    503,
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const player = params.get('player');
  try {
    const view = await roomView(player);
    if (view.error) return json(view, statusFor(view));
    return json(makeRoomTransport(view, params.get('cursor')));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  let body: Parameters<typeof roomCommand>[0] & { cursor?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Некорректный запрос.' }, 400);
  }
  try {
    const result = await roomCommand(body);
    if (!Array.isArray(result.seats)) return json(result, statusFor(result));
    const transport = makeRoomTransport(
      result,
      typeof body.cursor === 'string' ? body.cursor : null,
    );
    const { troopJournal: _journal, game: _game, ...rest } = result;
    return json({ ...rest, transport }, statusFor(result));
  } catch (error) {
    return failure(error);
  }
}
