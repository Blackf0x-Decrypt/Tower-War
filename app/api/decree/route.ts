import { initialGame } from '@/lib/tower-game';
import { env } from 'cloudflare:workers';
import {
  localCustomCandidate,
  localDecreeCandidates,
  validDecree,
  directVictory,
  type DecreeCandidate,
} from '@/lib/decrees';
const settings = () => {
  const e = env as { DEEPSEEK_API_KEY?: string; DEEPSEEK_MODEL?: string };
  return {
    key: String(e.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || ''),
    model: String(
      e.DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    ),
  };
};
function safeCandidatePatch(value: unknown) {
  if (!validDecree(value)) return false;
  const actions = value.kind === 'batch' ? value.actions : [value];
  return actions.every(
    (action) =>
      ['main', 'all', 'everyone'].includes(String(action.target)) &&
      ['reinforce', 'gold', 'resources', 'shield'].includes(action.kind) &&
      action.amount >= 0 &&
      action.amount <= 60,
  );
}
export async function GET() {
  return Response.json(
    { provider: settings().key ? 'deepseek' : 'local' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return Response.json(
      { error: 'Недопустимый источник запроса.' },
      { status: 403 },
    );
  const raw = await request.text();
  if (raw.length > 4096)
    return Response.json({ error: 'Слишком длинный запрос.' }, { status: 413 });
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Некорректный запрос.' }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== 'object' ||
    typeof body.prompt !== 'string' ||
    !body.prompt.trim() ||
    body.prompt.length > 350
  )
    return Response.json(
      { error: 'Напишите приказ длиной до 350 символов.' },
      { status: 400 },
    );
  if (directVictory(body.prompt))
    return Response.json(
      {
        error:
          'Нельзя напрямую объявить победу. Измени мир так, чтобы победить по итогам боя.',
      },
      { status: 422 },
    );
  const { key, model } = settings();
  if (body.custom === true) {
    const custom = localCustomCandidate(body.prompt);
    return custom
      ? Response.json({
          provider: key ? 'deepseek' : 'local',
          custom: custom satisfies DecreeCandidate,
        })
      : Response.json(
          {
            error:
              'Своя формулировка может усиливать только ваши штаб/команду: подкрепление, золото, древесина или щит.',
          },
          { status: 422 },
        );
  }
  if (!key) {
    return Response.json({
      candidates: localDecreeCandidates(body.prompt),
      provider: 'local',
    });
  }
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        max_tokens: 1900,
        messages: [
          {
            role: 'system',
            content: `Сгенерируй РОВНО три смешных, но честных для лидера варианта указа на русском. Каждый действует только на лидера: target строго main или all, разрешены только reinforce, gold, resources, shield. Эффекты умеренные: reinforce 10..40, gold/resources 15..60, shield 10..30 секунд. Каждый вариант обязан иметь основной эффект и уже предопределённый дополнительный эффект в patch batch. Верни JSON {"candidates":[{"id":"a","title":"...","flavor":"...","description":"точный основной эффект","sideEffect":"точный дополнительный эффект","patch":{"kind":"batch","actions":[...]}}]}. Никакого кода.
Цели: main=все принадлежащие игроку главные штабы (для «моё главное здание» всегда используй main, а не ID 0); all=вся команда игрока; red=все красные (Красный); purple=все фиолетовые (Фиолетовый); green=все зелёные (Зелёный); enemies=все противники; everyone=вообще все включая игрока; neutral=нейтральные здания; число=ID конкретного здания. Игрок за синих — это команда лидера (main/all), не red/purple/green.
Действия:
messages: выключить ВСЕ облачка сообщений amount=0 или включить amount=1, target=everyone. Промпты по центру не скрываются. «удали сообщения» = messages everyone 0.
transfer: передать игроку ВСЕ здания и бегущих/ожидающих бойцов выбранной команды, amount=1.
capture: передать только здания игроку (любые, включая штабы), amount=1.
destroy: убрать выбранные войска, освободить и обнулить их здания, отключить их штабы, amount=1.
reinforce: ПРИБАВИТЬ amount к гарнизонам выбранной цели (отрицательное число убавляет). «дай главному 100» = +100, не установка.
set: установить численность гарнизонов в amount.
multiply: умножить гарнизоны и выбранные отряды на amount.
growth/speed: установить множитель производства/бега выбранной команды, от 0 до 1000 (0 останавливает). При просьбе «вдвое» ставь 2.
freeze/shield: заморозка движения и производства / неуязвимость зданий на amount секунд.
upgrade: установить уровень зданий 1..10.
time: оставить amount секунд до конца, target=everyone.
gold/resources: добавить amount золота/древесины указанной команде (отрицательное убавляет). Подарки не считаются заработанными очками. Нельзя отменять 4-минутную фазу развития — приказы применяются только после неё.
Численности и длительности конечные, максимум 1 миллиард. Это технические границы, не баланс. Не добавляй ограничение 500 или ×5. Для «бесконечно» используй этот технический максимум (множители до 1000).
Карта (ID и названия): ${initialGame()
              .towers.map((t) => `${t.id}: ${t.name}`)
              .join(
                '; ',
              )}. Видимые номера 1..24 = ID+1. Главные штабы ID 0,6,12,18.
Примеры: «все красные теперь мои» -> {"kind":"transfer","target":"red","amount":1}; «уничтожь красных» -> {"kind":"destroy","target":"red","amount":1}; «дай штабу 100 и заморозь врагов на 20 секунд» -> batch reinforce main 100, freeze enemies 20.
Составные приказы выполняй полностью по порядку. Если невозможно выразить требуемый эффект этими операциями, верни {"error":"объяснение, какой эффект требует расширения движка"}, не подменяй желание другим эффектом. Не считай невозможность выражения запретом по правилам игры.`,
          },
          { role: 'user', content: body.prompt },
        ],
      }),
    });
    if (!response.ok)
      return Response.json(
        {
          error:
            response.status === 401
              ? 'Ключ DeepSeek не принят. Проверьте серверную настройку.'
              : response.status === 402
                ? 'На счёте DeepSeek недостаточно средств.'
                : 'DeepSeek пока не ответил. Попробуйте ещё раз.',
        },
        { status: 502 },
      );
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    const candidates = parsed.candidates;
    const safe = Array.isArray(candidates)
      ? candidates.filter(
          (candidate): candidate is DecreeCandidate =>
            !!candidate &&
            typeof candidate === 'object' &&
            typeof candidate.id === 'string' &&
            typeof candidate.title === 'string' &&
            typeof candidate.flavor === 'string' &&
            typeof candidate.description === 'string' &&
            typeof candidate.sideEffect === 'string' &&
            safeCandidatePatch(candidate.patch),
        )
      : [];
    if (safe.length !== 3)
      return Response.json(
        { candidates: localDecreeCandidates(body.prompt), provider: 'local' },
      );
    return Response.json({
      provider: 'deepseek',
      candidates: safe,
    });
  } catch {
    return Response.json({
      candidates: localDecreeCandidates(body.prompt),
      provider: 'local',
    });
  }
}
