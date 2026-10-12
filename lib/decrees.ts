export type Target =
  | 'main'
  | 'all'
  | 'red'
  | 'purple'
  | 'green'
  | 'enemies'
  | 'everyone'
  | 'neutral'
  | number;
export type Action = {
  kind:
    | 'messages'
    | 'reinforce'
    | 'set'
    | 'multiply'
    | 'growth'
    | 'speed'
    | 'capture'
    | 'transfer'
    | 'destroy'
    | 'freeze'
    | 'shield'
    | 'upgrade'
    | 'time'
    | 'gold'
    | 'resources';
  amount: number;
  target: Target;
};
export type Decree = Action | { kind: 'batch'; actions: Action[] };
export type DecreeCandidate = {
  id: string;
  title: string;
  flavor: string;
  description: string;
  sideEffect: string;
  patch: Decree;
};
function validAction(value: unknown): value is Action {
  if (!value || typeof value !== 'object') return false;
  const p = value as Action;
  if (
    ![
      'messages',
      'reinforce',
      'set',
      'multiply',
      'growth',
      'speed',
      'capture',
      'transfer',
      'destroy',
      'freeze',
      'shield',
      'upgrade',
      'time',
      'gold',
      'resources',
    ].includes(p.kind) ||
    !Number.isFinite(p.amount) ||
    Math.abs(p.amount) > 1e9
  )
    return false;
  if (
    !(
      [
        'main',
        'all',
        'red',
        'purple',
        'green',
        'enemies',
        'everyone',
        'neutral',
      ].includes(String(p.target)) ||
      (typeof p.target === 'number' &&
        Number.isInteger(p.target) &&
        p.target >= 0 &&
        p.target < 24)
    )
  )
    return false;
  if (
    [
      'multiply',
      'growth',
      'speed',
      'freeze',
      'shield',
      'upgrade',
      'set',
    ].includes(p.kind) &&
    p.amount < 0
  )
    return false;
  if (['growth', 'speed', 'multiply'].includes(p.kind) && p.amount > 1000)
    return false;
  if (
    p.kind === 'messages' &&
    (![0, 1].includes(p.amount) || p.target !== 'everyone')
  )
    return false;
  return true;
}
export function validDecree(value: unknown): value is Decree {
  if (!value || typeof value !== 'object') return false;
  const p = value as Decree;
  return p.kind === 'batch'
    ? Array.isArray(p.actions) &&
        p.actions.length > 0 &&
        p.actions.length <= 12 &&
        p.actions.every(validAction)
    : validAction(value);
}
export function directVictory(prompt: string) {
  return /^(?:(?:сделай|объяви|засчитай|дай)\s+(?:мне\s+)?(?:мгновенную\s+)?побед\S*|я\s+(?:уже\s+)?победил[аи]?|i\s+win|make\s+me\s+win)[.!\s]*$/iu.test(
    prompt.trim(),
  );
}
export function localDecree(prompt: string): Decree | null {
  const text = prompt.toLowerCase().replaceAll('ё', 'е').trim();
  if (directVictory(text)) return null;
  if (/(?:удали|убери|скрой|отключи).*сообщени/.test(text))
    return { kind: 'messages', target: 'everyone', amount: 0 };
  const parts = text
    .split(
      /\s*(?:;|\n|,\s*(?:а\s+)?затем\s+|\s+и\s+(?=уничтож|дай|добав|ускор|замороз|захват))\s*/,
    )
    .filter(Boolean);
  if (parts.length > 1) {
    const actions = parts.map(localDecree);
    if (actions.every((x): x is Action => !!x && x.kind !== 'batch'))
      return { kind: 'batch', actions };
    return null;
  }
  const target: Target = /красн|бот 1/.test(text)
    ? 'red'
    : /фиолет|бот 2/.test(text)
      ? 'purple'
      : /зелен|бот 3/.test(text)
        ? 'green'
        : /враг|враж|противник/.test(text)
          ? 'enemies'
          : /нейтрал/.test(text)
            ? 'neutral'
            : /главн|штаб|баз/.test(text)
              ? 'main'
              : /вообще все|всех игроков/.test(text)
                ? 'everyone'
                : 'all';
  const match = text.match(/-?\d+(?:[.,]\d+)?/);
  const amount = match ? Number(match[0].replace(',', '.')) : null;
  let p: Action | null = null;
  if (/золот/.test(text) && amount !== null)
    p = { kind: 'gold', target: target === 'main' ? 'all' : target, amount };
  else if (/древес|ресурс/.test(text) && amount !== null)
    p = {
      kind: 'resources',
      target: target === 'main' ? 'all' : target,
      amount,
    };
  else if (/(?:теперь мои|сделай моими|переман|захват|передай мне)/.test(text))
    p = { kind: 'transfer', target, amount: 1 };
  else if (/уничтож|убей|сотри|убери|ликвидируй/.test(text))
    p = { kind: 'destroy', target, amount: 1 };
  else if (/замороз|останов/.test(text))
    p = { kind: 'freeze', target, amount: amount ?? 30 };
  else if (/бессмерт|неуязвим|щит/.test(text))
    p = { kind: 'shield', target, amount: amount ?? 240 };
  else if (/прирост|производ|генер|рожда/.test(text))
    p = {
      kind: 'growth',
      target: target === 'main' ? 'all' : target,
      amount: amount ?? 2,
    };
  else if (/скорост|ускор|быстр|замедл/.test(text))
    p = {
      kind: 'speed',
      target: target === 'main' ? 'all' : target,
      amount: amount ?? (/замедл/.test(text) ? 0.5 : 2),
    };
  else if (/удво|утро|умнож/.test(text))
    p = {
      kind: 'multiply',
      target,
      amount: amount ?? (/утро/.test(text) ? 3 : 2),
    };
  else if (/дай|добав|прибав|увелич|\+|подкреп/.test(text) && amount !== null)
    p = { kind: 'reinforce', amount, target };
  return p && validDecree(p) ? p : null;
}

function actionLabel(action: Action) {
  if (action.kind === 'reinforce') return `+${action.amount} бойцов штабу`;
  if (action.kind === 'gold') return `+${action.amount} золота`;
  if (action.kind === 'resources') return `+${action.amount} древесины`;
  if (action.kind === 'shield') return `щит штабу на ${action.amount} с`;
  return 'изменение по указу';
}

function withSideEffect(main: Action, seed: number): DecreeCandidate {
  const extras: Action[] = [
    { kind: 'reinforce', target: 'main', amount: 8 },
    { kind: 'gold', target: 'all', amount: 12 },
    { kind: 'resources', target: 'all', amount: 12 },
    { kind: 'shield', target: 'main', amount: 15 },
  ];
  const extra = extras[Math.abs(seed) % extras.length];
  const patch: Decree = { kind: 'batch', actions: [main, extra] };
  return {
    id: `${main.kind}-${seed}`,
    title: '',
    flavor: '',
    description: actionLabel(main),
    sideEffect: `Случайный довесок уже определён: ${actionLabel(extra)}.`,
    patch,
  };
}

function stableSeed(text: string, salt: number) {
  let value = 2166136261 ^ salt;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value | 0;
}

/**
 * The fallback is deliberately modest and targets only the decree author.
 * It always returns exactly three visible, valid choices, so a provider
 * outage never blocks the match.
 */
export function localDecreeCandidates(prompt: string): DecreeCandidate[] {
  const seed = stableSeed(prompt, 17);
  const candidates = [
    withSideEffect(
      { kind: 'reinforce', target: 'main', amount: 24 },
      seed,
    ),
    withSideEffect({ kind: 'gold', target: 'all', amount: 36 }, seed + 1),
    withSideEffect(
      { kind: 'resources', target: 'all', amount: 36 },
      seed + 2,
    ),
  ];
  const labels = [
    ['Срочно увеличить гарнизон штаба', 'Канцелярия нашла ещё один ящик касок.'],
    ['Золотая лихорадка', 'Казначейство торжественно трясёт копилкой.'],
    ['Инженерный перекур', 'Инженеры вернулись с досками и непрошеными идеями.'],
  ];
  return candidates.map((candidate, index) => ({
    ...candidate,
    id: `local-${index}`,
    title: labels[index][0],
    flavor: labels[index][1],
  }));
}

/**
 * Custom wording remains constrained to the DSL and to the leader's own
 * assets. It is intentionally narrower than the legacy free-form parser.
 */
export function localCustomDecree(prompt: string): Decree | null {
  const parsed = localDecree(prompt);
  if (!parsed || !validDecree(parsed)) return null;
  const actions = parsed.kind === 'batch' ? parsed.actions : [parsed];
  if (
    actions.some(
      (action) =>
        !['main', 'all'].includes(String(action.target)) ||
        !['reinforce', 'gold', 'resources', 'shield'].includes(action.kind) ||
        action.amount < 0 ||
        action.amount > 60,
    )
  )
    return null;
  return parsed;
}

export function localCustomCandidate(prompt: string): DecreeCandidate | null {
  const patch = localCustomDecree(prompt);
  if (!patch) return null;
  const actions = patch.kind === 'batch' ? patch.actions : [patch];
  const extra: Action = [
    { kind: 'reinforce', target: 'main', amount: 6 },
    { kind: 'gold', target: 'all', amount: 10 },
    { kind: 'resources', target: 'all', amount: 10 },
  ][Math.abs(stableSeed(prompt, 91)) % 3];
  return {
    id: 'custom',
    title: 'Ваш приказ',
    flavor: 'Собственная формулировка лидера.',
    description: actions.map(actionLabel).join(' · '),
    sideEffect: `Случайный довесок уже определён: ${actionLabel(extra)}.`,
    patch: { kind: 'batch', actions: [...actions, extra] },
  };
}
