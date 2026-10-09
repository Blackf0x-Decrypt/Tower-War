import { RoomBusyError } from '@/lib/room-store';
import { roomCommand, roomView, type RoomView } from '@/lib/room';

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

export async function GET(request: Request) {
  const player = new URL(request.url).searchParams.get('player');
  try {
    const view = await roomView(player);
    return json(view, statusFor(view));
  } catch (error) {
    const message =
      error instanceof RoomBusyError
        ? error.message
        : 'Комната временно недоступна. Обновите страницу.';
    return json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: Parameters<typeof roomCommand>[0];
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Некорректный запрос.' }, { status: 400 });
  }
  try {
    const result = await roomCommand(body);
    return json(result, statusFor(result));
  } catch (error) {
    const message =
      error instanceof RoomBusyError
        ? error.message
        : 'Комната временно недоступна. Обновите страницу.';
    return json({ error: message }, { status: 503 });
  }
}
