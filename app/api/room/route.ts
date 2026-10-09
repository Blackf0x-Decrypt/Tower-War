import { roomCommand, roomView } from '@/lib/room';

export async function GET(request: Request) {
  const player = new URL(request.url).searchParams.get('player');
  return Response.json(roomView(player), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request) {
  let body: Parameters<typeof roomCommand>[0];
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Некорректный запрос.' }, { status: 400 });
  }
  const result = roomCommand(body);
  const status = 'error' in result && !('seats' in result) ? 400 : 200;
  return Response.json(result, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
