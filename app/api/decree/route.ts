import { env } from 'cloudflare:workers';
import {
  CHAOS_SCHEMA_DOC,
  localCustomCandidate,
  localDecreeCandidates,
  directVictory,
  decreePromptForCandidates,
  sanitizeDecreeCandidates,
  type DecreeCandidate,
  validPlayerDecree,
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
export async function GET() {
  return Response.json(
    { provider: settings().key ? 'deepseek' : 'local' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
async function deepSeekCandidates(prompt: string, key: string, model: string) {
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
      max_tokens: 2200,
      messages: [
        {
          role: 'system',
          content: `Ты генератор ЭКСТРЕМАЛЬНЫХ, несовместимых с обычной игрой указов для PvP «Tower War». РОВНО три РАЗНЫХ варианта на русском.
Каждый указ должен ломать матч: монополия дохода, зеркальные волны ×3–4, туман владения, перекраска карты, кровопийца гарнизонов, бумеранг legions, рой автовыбросов, пушечный шквал, волна нейтралов от штаба, враги ползут/бегут задом, удары лечат врагов, сжатие времени прироста, телепорт всех зданий, штурм HQ.
ЗАПРЕЩЕНО: +gold, +resources, reinforce как основной эффект. ЗАПРЕЩЕНО target everyone/neutral/red/purple/green.
Комбинируй два РАЗНЫХ жёстких chaos в batch. param и amount — на верхней границе допустимого, не «скромные» бафы.
${CHAOS_SCHEMA_DOC}
title — короткий приказ, flavor — шутка, description = основной эффект, sideEffect = довесок.
JSON {"candidates":[{"id":"a","title":"...","flavor":"...","description":"...","sideEffect":"...","patch":{"kind":"batch","actions":[{...},{...}]}}]}.`,
        },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) return { error: response.status, candidates: null as const };
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  const safe = sanitizeDecreeCandidates(parsed.candidates);
  return safe.length === 3
    ? { error: null, candidates: safe }
    : { error: null, candidates: null as const };
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
  let body: {
    action?: string;
    prompt?: string;
    context?: string;
    custom?: boolean;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Некорректный запрос.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object')
    return Response.json({ error: 'Некорректный запрос.' }, { status: 400 });

  const isCustom = body.custom === true || body.action === 'custom';
  if (isCustom) {
    if (typeof body.prompt !== 'string' || !body.prompt.trim())
      return Response.json(
        { error: 'Напишите приказ длиной до 350 символов.' },
        { status: 400 },
      );
    if (body.prompt.length > 350)
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
    const { key } = settings();
    const custom = localCustomCandidate(body.prompt);
    return custom
      ? Response.json({
          provider: key ? 'deepseek' : 'local',
          custom: custom satisfies DecreeCandidate,
        })
      : Response.json(
          {
            error:
              'Опишите безумное правило: монополия дохода, зеркальная волна, туман карты, перекраска, кровопийца, рой, пушки, волна нейтралов…',
          },
          { status: 422 },
        );
  }

  const explicitPrompt = body.prompt?.trim() ?? '';
  if (explicitPrompt.length > 350)
    return Response.json(
      { error: 'Напишите приказ длиной до 350 символов.' },
      { status: 400 },
    );
  if (explicitPrompt && directVictory(explicitPrompt))
    return Response.json(
      {
        error:
          'Нельзя напрямую объявить победу. Измени мир так, чтобы победить по итогам боя.',
      },
      { status: 422 },
    );

  const prompt = decreePromptForCandidates(body.prompt, body.context);
  const { key, model } = settings();
  if (!key) {
    return Response.json({
      candidates: localDecreeCandidates(prompt),
      provider: 'local',
    });
  }
  try {
    const result = await deepSeekCandidates(prompt, key, model);
    if (result.error === 401)
      return Response.json(
        {
          error:
            'Ключ DeepSeek не принят. Проверьте серверную настройку.',
        },
        { status: 502 },
      );
    if (result.error === 402)
      return Response.json(
        {
          error: 'На счёте DeepSeek недостаточно средств.',
        },
        { status: 502 },
      );
    if (result.error && result.error !== null)
      return Response.json(
        { error: 'DeepSeek пока не ответил. Попробуйте ещё раз.' },
        { status: 502 },
      );
    if (result.candidates)
      return Response.json({
        provider: 'deepseek',
        candidates: result.candidates,
      });
    return Response.json({
      candidates: localDecreeCandidates(prompt),
      provider: 'local',
    });
  } catch {
    return Response.json({
      candidates: localDecreeCandidates(prompt),
      provider: 'local',
    });
  }
}
