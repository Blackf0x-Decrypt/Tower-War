import {
  CHAOS_EFFECT_KINDS,
  chaosTargetsEnemies,
  isChaosKind,
  type ChaosEffectKind,
} from './chaos-rules';

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

export const LEGACY_ACTION_KINDS = [
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
] as const;

export type LegacyActionKind = (typeof LEGACY_ACTION_KINDS)[number];
export type ActionKind = LegacyActionKind | ChaosEffectKind;

export type Action = {
  kind: ActionKind;
  amount: number;
  target: Target;
  /** Secondary magnitude (multipliers ×10, counts, etc.). */
  param?: number;
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

const LEGACY_SET = new Set<string>(LEGACY_ACTION_KINDS);
const CHAOS_SET = new Set<string>(CHAOS_EFFECT_KINDS);

function validTarget(value: unknown): value is Target {
  return (
    [
      'main',
      'all',
      'red',
      'purple',
      'green',
      'enemies',
      'everyone',
      'neutral',
    ].includes(String(value)) ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value < 24)
  );
}

function validLegacyAction(value: Action): boolean {
  if (!LEGACY_SET.has(value.kind)) return false;
  if (!Number.isFinite(value.amount) || Math.abs(value.amount) > 1e9) return false;
  if (!validTarget(value.target)) return false;
  if (
    [
      'multiply',
      'growth',
      'speed',
      'freeze',
      'shield',
      'upgrade',
      'set',
    ].includes(value.kind) &&
    value.amount < 0
  )
    return false;
  if (['growth', 'speed', 'multiply'].includes(value.kind) && value.amount > 1000)
    return false;
  if (
    value.kind === 'messages' &&
    (![0, 1].includes(value.amount) || value.target !== 'everyone')
  )
    return false;
  return true;
}

/** Server-side bounds for chaos effects in player decrees. */
function validChaosPlayerAction(a: Action): boolean {
  if (!isChaosKind(a.kind)) return false;
  if (!validTarget(a.target)) return false;
  const param = a.param ?? 0;
  if (!Number.isFinite(param)) return false;
  const duration = a.amount;
  if (!Number.isFinite(duration) || duration < 0 || duration > 120) return false;

  const leaderTarget =
    a.target === 'main' || a.target === 'all' || a.target === 'enemies';
  if (!leaderTarget) return false;
  const enemyKind = chaosTargetsEnemies(a.kind);
  if (enemyKind && a.target !== 'enemies') return false;
  if (!enemyKind && a.target === 'enemies') return false;

  switch (a.kind) {
    case 'chaos_march_speed':
    case 'chaos_production_surge':
    case 'chaos_capture_rush':
      return duration >= 15 && duration <= 105 && param >= 18 && param <= 55;
    case 'chaos_time_warp':
      return duration >= 22 && duration <= 100 && param >= 25 && param <= 45;
    case 'chaos_enemy_crawl':
    case 'chaos_enemy_retreat':
      return (
        a.target === 'enemies' &&
        duration >= 18 &&
        duration <= 100 &&
        param >= 3 &&
        param <= 14
      );
    case 'chaos_hq_shield':
      return a.target === 'main' && duration >= 12 && duration <= 65;
    case 'chaos_double_wave':
    case 'chaos_reverse_march':
    case 'chaos_economy_swap':
    case 'chaos_boomerang_legions':
    case 'chaos_hive_mind':
      return duration >= 18 && duration <= 95 && param >= 0 && param <= 100;
    case 'chaos_garrison_tremor':
      return (
        a.target === 'enemies' &&
        duration >= 18 &&
        duration <= 90 &&
        param >= 25 &&
        param <= 80
      );
    case 'chaos_garrison_vamp':
      return duration >= 25 && duration <= 100 && param >= 12 && param <= 45;
    case 'chaos_monopoly_income':
      return duration >= 28 && duration <= 100 && param >= 20 && param <= 38;
    case 'chaos_mirror_army':
      return duration >= 18 && duration <= 85 && param >= 3 && param <= 4;
    case 'chaos_fog_flicker':
      return duration >= 35 && duration <= 110 && param >= 16 && param <= 72;
    case 'chaos_cannon_overdrive':
      return duration >= 22 && duration <= 90 && param >= 22 && param <= 50;
    case 'chaos_enemy_fortify':
      return duration >= 20 && duration <= 95 && param >= 0 && param <= 100;
    case 'chaos_enemy_send_lock':
      return a.target === 'enemies' && duration >= 14 && duration <= 55;
    case 'chaos_hq_siege':
      return duration >= 25 && duration <= 75;
    case 'chaos_neutral_uprising':
      return duration === 0 && param >= 12 && param <= 50;
    case 'chaos_neutral_ripple':
      return duration === 0 && param >= 14 && param <= 48;
    case 'chaos_mine_birth':
      return duration === 0 && param >= 10 && param <= 45;
    case 'chaos_building_shuffle':
      return duration === 0 && param >= 1 && param <= 99;
    case 'chaos_land_flip':
      return duration === 0 && param >= 0 && param <= 99;
    default:
      return false;
  }
}

function validPlayerLegacyAction(a: Action): boolean {
  if (!validLegacyAction(a)) return false;
  if (
    !['main', 'all'].includes(String(a.target)) ||
    !['reinforce', 'gold', 'resources', 'shield'].includes(a.kind)
  )
    return false;
  return a.amount >= 0 && a.amount <= 40;
}

export function validAction(value: unknown): value is Action {
  if (!value || typeof value !== 'object') return false;
  const p = value as Action;
  if (isChaosKind(p.kind)) {
    return (
      Number.isFinite(p.amount) &&
      (p.param === undefined || Number.isFinite(p.param))
    );
  }
  return validLegacyAction(p);
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

export function validPlayerDecree(value: unknown): value is Decree {
  if (!validDecree(value)) return false;
  const actions = value.kind === 'batch' ? value.actions : [value];
  if (actions.length < 1 || actions.length > 4) return false;
  return actions.every(
    (action) =>
      validChaosPlayerAction(action) || validPlayerLegacyAction(action),
  );
}

export function directVictory(prompt: string) {
  return /^(?:(?:сделай|объяви|засчитай|дай)\s+(?:мне\s+)?(?:мгновенную\s+)?побед\S*|я\s+(?:уже\s+)?победил[аи]?|i\s+win|make\s+me\s+win)[.!\s]*$/iu.test(
    prompt.trim(),
  );
}

export const DEFAULT_DECREE_SEED = 'случайный приказ';

export function decreePromptForCandidates(
  prompt?: string | null,
  context?: string | null,
): string {
  const trimmed = prompt?.trim();
  if (trimmed) return trimmed.slice(0, 350);
  const ctx = context?.trim();
  if (ctx) return ctx.slice(0, 350);
  return DEFAULT_DECREE_SEED;
}

export function gameDecreeContextSeed(summary: {
  elapsed: number;
  towers: number;
  earned: number;
  epoch: number;
}): string {
  return `лидер · эпоха ${summary.epoch} · башен ${summary.towers} · очков ${Math.floor(summary.earned)} · ${Math.floor(summary.elapsed)}с`;
}

export function sanitizeDecreeCandidates(raw: unknown): DecreeCandidate[] {
  if (!Array.isArray(raw)) return [];
  const safe = raw.filter(
    (candidate): candidate is DecreeCandidate =>
      !!candidate &&
      typeof candidate === 'object' &&
      typeof (candidate as DecreeCandidate).id === 'string' &&
      typeof (candidate as DecreeCandidate).title === 'string' &&
      typeof (candidate as DecreeCandidate).flavor === 'string' &&
      typeof (candidate as DecreeCandidate).description === 'string' &&
      typeof (candidate as DecreeCandidate).sideEffect === 'string' &&
      validPlayerDecree((candidate as DecreeCandidate).patch),
  );
  return safe.length === 3 ? safe : [];
}

export function chaosEffectLabel(action: Action): string {
  const p = action.param ?? 0;
  const d = action.amount;
  switch (action.kind) {
    case 'chaos_march_speed':
      return `Марш ×${(p / 10).toFixed(1)} · ${d} с`;
    case 'chaos_production_surge':
      return `Прирост ×${(p / 10).toFixed(1)} · ${d} с`;
    case 'chaos_hq_shield':
      return `Штаб неуязвим · ${d} с`;
    case 'chaos_double_wave':
      return `Двойной выброс отрядов · ${d} с`;
    case 'chaos_reverse_march':
      return `Солдаты идут задом · ${d} с`;
    case 'chaos_enemy_send_lock':
      return `Враги не могут посылать армии · ${d} с`;
    case 'chaos_enemy_crawl':
      return `Враги ползут ×${(p / 10).toFixed(1)} · ${d} с`;
    case 'chaos_neutral_uprising':
      return `Нейтралы просыпаются · +${p} в точках`;
    case 'chaos_mine_birth':
      return `Шахты рожают ${p} бойцов`;
    case 'chaos_building_shuffle':
      return `Здания телепортируются`;
    case 'chaos_hq_siege':
      return `Штабы можно штурмовать · ${d} с`;
    case 'chaos_capture_rush':
      return `Захват ×${(p / 10).toFixed(1)} · ${d} с`;
    case 'chaos_economy_swap':
      return `Золото ↔ древесина · ${d} с`;
    case 'chaos_garrison_tremor':
      return `Враги теряют до ${p}% гарнизона · ${d} с`;
    case 'chaos_enemy_retreat':
      return `Враги отступают задом · ${d} с`;
    case 'chaos_garrison_vamp':
      return `Кровопийца: ${p}% с захватов · ${d} с`;
    case 'chaos_monopoly_income':
      return `Монополия ×${(p / 10).toFixed(1)}, враги $0 · ${d} с`;
    case 'chaos_mirror_army':
      return `Зеркальная волна ×${p} · ${d} с`;
    case 'chaos_fog_flicker':
      return `Туман: карта мерцает · ${d} с`;
    case 'chaos_cannon_overdrive':
      return `Пушки ×${(p / 10).toFixed(1)} · ${d} с`;
    case 'chaos_neutral_ripple':
      return `Волна нейтралов R${p} от штаба`;
    case 'chaos_enemy_fortify':
      return `Удары лечат врагов · ${d} с`;
    case 'chaos_time_warp':
      return `Время ×${(p / 10).toFixed(1)} прирост · ${d} с`;
    case 'chaos_boomerang_legions':
      return `Бумеранг: отступившие живы · ${d} с`;
    case 'chaos_hive_mind':
      return `Рой: автовыбросы · ${d} с`;
    case 'chaos_land_flip':
      return `Перекраска карты с соперником`;
    default:
      return 'хаос';
  }
}

export function describePlayerDecreePatch(patch: Decree): string {
  const actions = patch.kind === 'batch' ? patch.actions : [patch];
  return actions.map((a) => chaosEffectLabel(a)).join(' · ');
}

/** DeepSeek + docs: allowed chaos kinds for JSON generation. */
export const CHAOS_SCHEMA_DOC = `Разрешённые kind (только они): ${CHAOS_EFFECT_KINDS.join(', ')}.
Поля action: kind, target (main|all|enemies), amount (длительность 0–120 с; 0 = мгновенно), param (сила эффекта).
target enemies: chaos_enemy_send_lock, chaos_enemy_crawl, chaos_enemy_retreat, chaos_garrison_tremor.
×10 множители (march, production, capture, cannon, monopoly, time_warp): param 18–55 где уместно.
Комбо должны ломать матч: монополия дохода, зеркальные волны ×3–4, туман владения, перекраска карты, кровопийца гарнизонов, бумеранг legions, рой автовыбросов, пушечный шквал, волна нейтралов от штаба, удары лечат врагов.
ЗАПРЕЩЕНО скучное +gold/+wood/+reinforce. Каждый patch: {"kind":"batch","actions":[основной, довесок]} — два РАЗНЫХ жёстких chaos-эффекта.`;

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
  const custom = localCustomDecree(prompt);
  if (custom) return custom;
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

type ChaosTemplate = {
  kind: ChaosEffectKind;
  target: Target;
  duration: number;
  param: number;
  titles: string[];
  flavors: string[];
};

const CHAOS_TEMPLATES: ChaosTemplate[] = [
  {
    kind: 'chaos_reverse_march',
    target: 'all',
    duration: 38,
    param: 0,
    titles: ['Марш задом-передом', 'Ретро-наступление', 'Контрмарш'],
    flavors: [
      'Генштаб перепутал «вперёд» и «назад» на карте.',
      'Сапоги смотрят домой, дух смотрит вперёд.',
    ],
  },
  {
    kind: 'chaos_double_wave',
    target: 'all',
    duration: 32,
    param: 0,
    titles: ['Двойной выброс', 'Клонированный приказ', 'Волна ×2'],
    flavors: ['Каждый солдат тащит за собой ещё одного.', 'Кнопка «отправить» залипла.'],
  },
  {
    kind: 'chaos_enemy_send_lock',
    target: 'enemies',
    duration: 38,
    param: 0,
    titles: ['Клещ на радио врага', 'Эфирное молчание', 'Запрет исходящих'],
    flavors: ['Противнику отключили кнопку «выдвинуться».', 'Почта generals@enemy недоступна.'],
  },
  {
    kind: 'chaos_hq_siege',
    target: 'all',
    duration: 55,
    param: 0,
    titles: ['Штабы на столе', 'Открытая охота на HQ', 'Сейф без замка'],
    flavors: ['Протокол «штаб священен» сгорел в печи.', 'Теперь можно брать базу силой.'],
  },
  {
    kind: 'chaos_mine_birth',
    target: 'all',
    duration: 0,
    param: 32,
    titles: ['Шахты рожают пехоту', 'Золото идёт пешком', 'Рудник-мобилизация'],
    flavors: ['Жила оказалась одетой в каски.', 'Лесопилка выплёвывает резерв.'],
  },
  {
    kind: 'chaos_building_shuffle',
    target: 'all',
    duration: 0,
    param: 88,
    titles: ['Телепорт квартала', 'Карусель форпостов', 'Анархия координат'],
    flavors: ['Картограф уронил чернильницу на карту.', 'Здания поменялись местами за ночь.'],
  },
  {
    kind: 'chaos_neutral_uprising',
    target: 'all',
    duration: 0,
    param: 38,
    titles: ['Бунт нейтралов', 'Проснулись заборы', 'Серые зоны встают'],
    flavors: ['Никто не владел точкой — теперь владелец вы.', 'Нейтрал решил, что скучно.'],
  },
  {
    kind: 'chaos_economy_swap',
    target: 'all',
    duration: 45,
    param: 0,
    titles: ['Инверсия казны', 'Золото — это дерево', 'Бухгалтерский переворот'],
    flavors: ['Казначей перепутал колонки Excel.', 'Шахта платит досками, лес — монетами.'],
  },
  {
    kind: 'chaos_march_speed',
    target: 'all',
    duration: 48,
    param: 42,
    titles: ['Гипермарш', 'Кофе для всех', 'Сапоги в огне'],
    flavors: ['Приказ: бежать так, будто опоздали на победу.'],
  },
  {
    kind: 'chaos_production_surge',
    target: 'all',
    duration: 42,
    param: 38,
    titles: ['Казарменный взрыв', 'Конвейер каск', 'Перепроизводство'],
    flavors: ['Казарма задымилась от скорости набора.'],
  },
  {
    kind: 'chaos_capture_rush',
    target: 'all',
    duration: 40,
    param: 36,
    titles: ['Захват на бегу', 'Штурм без пауз', 'Флаг в землю'],
    flavors: ['Каждый удар по стене считается двойным.'],
  },
  {
    kind: 'chaos_hq_shield',
    target: 'main',
    duration: 38,
    param: 0,
    titles: ['Купол над штабом', 'Бюрократический щит', 'Печать «не трогать»'],
    flavors: ['Юристы нашли пункт о неприкосновенности.'],
  },
  {
    kind: 'chaos_enemy_crawl',
    target: 'enemies',
    duration: 42,
    param: 4,
    titles: ['Враги в сиропе', 'Липкий фронт', 'Замедленный соперник'],
    flavors: ['Противник марширует как в сне на парах.'],
  },
  {
    kind: 'chaos_garrison_tremor',
    target: 'enemies' as Target,
    duration: 38,
    param: 55,
    titles: ['Дрожь гарнизонов', 'Паника в башнях', 'Моральный толчок'],
    flavors: ['Чужие стены теряют бойцов от страха.'],
  },
  {
    kind: 'chaos_mirror_army',
    target: 'all',
    duration: 36,
    param: 4,
    titles: ['Зеркальный штаб', 'Тройной выброс', 'Армия-clone'],
    flavors: ['Каждый приказ эхом отдаётся трижды.', 'Клоны не спорят с оригиналом.'],
  },
  {
    kind: 'chaos_monopoly_income',
    target: 'all',
    duration: 50,
    param: 32,
    titles: ['Монополия эпохи', 'Казна только наша', 'Нулевой налог для врагов'],
    flavors: ['Враги получают квитанцию на ноль.', 'Весь доход карты — в одну кассу.'],
  },
  {
    kind: 'chaos_fog_flicker',
    target: 'all',
    duration: 55,
    param: 48,
    titles: ['Туман войны', 'Мерцание границ', 'Карта без GPS'],
    flavors: ['Флаги меняют цвет, пока вы моргаете.', 'Нейтралы не знают, чьи они.'],
  },
  {
    kind: 'chaos_cannon_overdrive',
    target: 'all',
    duration: 40,
    param: 38,
    titles: ['Пушечный шквал', 'Батарея без пауз', 'Громовой залп'],
    flavors: ['Стволы краснеют, но не остывают.'],
  },
  {
    kind: 'chaos_neutral_ripple',
    target: 'all',
    duration: 0,
    param: 32,
    titles: ['Волна от штаба', 'Радиус нейтралов', 'Импульс серых зон'],
    flavors: ['Штаб пульсирует — нейтралы падают вам в руки.'],
  },
  {
    kind: 'chaos_garrison_vamp',
    target: 'all',
    duration: 45,
    param: 28,
    titles: ['Кровопийца гарнизонов', 'Вампир захватов', 'Сифон чужих стен'],
    flavors: ['Каждый флаг — минус у соседа.'],
  },
  {
    kind: 'chaos_enemy_retreat',
    target: 'enemies',
    duration: 40,
    param: 8,
    titles: ['Паническое бегство', 'Враги — задом на фронт', 'Обратный марш соперника'],
    flavors: ['Генштаб врага перепутал «наступление» с «отступлением».'],
  },
  {
    kind: 'chaos_enemy_fortify',
    target: 'all',
    duration: 42,
    param: 0,
    titles: ['Проклятие крепости', 'Удары лечат врага', 'Обратный штурм'],
    flavors: ['Ваши пули — витамины для чужих стен. (Да, это намеренно.)'],
  },
  {
    kind: 'chaos_time_warp',
    target: 'all',
    duration: 48,
    param: 35,
    titles: ['Сжатие времени', 'Три секунды — три века', 'Ускоренная эволюция'],
    flavors: ['Казармы стареют бойцов за минуту.'],
  },
  {
    kind: 'chaos_boomerang_legions',
    target: 'all',
    duration: 44,
    param: 0,
    titles: ['Бумеранг legions', 'Отступившие живы', 'Возврат без билета'],
    flavors: ['Не взяли точку — солдаты домой.'],
  },
  {
    kind: 'chaos_hive_mind',
    target: 'all',
    duration: 38,
    param: 0,
    titles: ['Рой приказов', 'Ульевой разум', 'Боты без кнопки'],
    flavors: ['Каждое здание само выбирает жертву.'],
  },
  {
    kind: 'chaos_land_flip',
    target: 'all',
    duration: 0,
    param: 0,
    titles: ['Перекраска карты', 'Обмен территорией', 'Инверсия владения'],
    flavors: ['Ваши форпосты — их, их — ваши. Штабы не трогаем.'],
  },
];

const SIDE_CHAOS: ChaosTemplate[] = [
  {
    kind: 'chaos_enemy_crawl',
    target: 'enemies',
    duration: 28,
    param: 3,
    titles: [''],
    flavors: [''],
  },
  {
    kind: 'chaos_enemy_retreat',
    target: 'enemies',
    duration: 30,
    param: 6,
    titles: [''],
    flavors: [''],
  },
  {
    kind: 'chaos_garrison_tremor',
    target: 'enemies',
    duration: 26,
    param: 45,
    titles: [''],
    flavors: [''],
  },
  {
    kind: 'chaos_march_speed',
    target: 'all',
    duration: 22,
    param: 32,
    titles: [''],
    flavors: [''],
  },
  {
    kind: 'chaos_time_warp',
    target: 'all',
    duration: 24,
    param: 30,
    titles: [''],
    flavors: [''],
  },
  {
    kind: 'chaos_capture_rush',
    target: 'all',
    duration: 22,
    param: 34,
    titles: [''],
    flavors: [''],
  },
  {
    kind: 'chaos_enemy_fortify',
    target: 'all',
    duration: 25,
    param: 0,
    titles: [''],
    flavors: [''],
  },
  {
    kind: 'chaos_fog_flicker',
    target: 'all',
    duration: 38,
    param: 40,
    titles: [''],
    flavors: [''],
  },
];

function stableSeed(text: string, salt: number) {
  let value = 2166136261 ^ salt;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value | 0;
}

function pick<T>(list: T[], seed: number): T {
  return list[Math.abs(seed) % list.length];
}

function chaosAction(t: ChaosTemplate): Action {
  return {
    kind: t.kind,
    target: t.target,
    amount: t.duration,
    param: t.param,
  };
}

function buildCandidate(
  main: ChaosTemplate,
  side: ChaosTemplate,
  id: string,
  seed: number,
): DecreeCandidate {
  const mainAction = chaosAction(main);
  const sideAction = chaosAction(side);
  return {
    id,
    title: pick(main.titles, seed),
    flavor: pick(main.flavors, seed + 3),
    description: chaosEffectLabel(mainAction),
    sideEffect: `Довесок: ${chaosEffectLabel(sideAction)}`,
    patch: { kind: 'batch', actions: [mainAction, sideAction] },
  };
}

export function localDecreeCandidates(prompt: string): DecreeCandidate[] {
  const base = stableSeed(prompt, 17);
  const used = new Set<number>();
  const mains: ChaosTemplate[] = [];
  for (let i = 0; i < 3; i++) {
    let idx = Math.abs(base + i * 9973) % CHAOS_TEMPLATES.length;
    while (used.has(idx)) idx = (idx + 1) % CHAOS_TEMPLATES.length;
    used.add(idx);
    mains.push(CHAOS_TEMPLATES[idx]);
  }
  return mains.map((main, index) => {
    const side =
      SIDE_CHAOS[Math.abs(base + index * 31) % SIDE_CHAOS.length];
    return buildCandidate(main, side, `local-${index}`, base + index);
  });
}

function textToChaos(prompt: string): Action | null {
  const text = prompt.toLowerCase().replaceAll('ё', 'е');
  if (/задом|назад|ретро|backward/.test(text))
    return {
      kind: 'chaos_reverse_march',
      target: 'all',
      amount: 26,
      param: 0,
    };
  if (/двойн|удво.*отряд|волн.*2|×2/.test(text))
    return { kind: 'chaos_double_wave', target: 'all', amount: 24, param: 0 };
  if (/замороз.*враг|враг.*не.*шл|блок.*исход/.test(text))
    return {
      kind: 'chaos_enemy_send_lock',
      target: 'enemies',
      amount: 20,
      param: 0,
    };
  if (/штурм.*штаб|штаб.*можно|hq|баз.*захват/.test(text))
    return { kind: 'chaos_hq_siege', target: 'all', amount: 30, param: 0 };
  if (/шахт|рудник|лесопил/.test(text))
    return { kind: 'chaos_mine_birth', target: 'all', amount: 0, param: 16 };
  if (/телепорт|перемеш|shuffle|анарх/.test(text))
    return {
      kind: 'chaos_building_shuffle',
      target: 'all',
      amount: 0,
      param: 50,
    };
  if (/волн.*штаб|радиус.*нейтрал|импульс.*нейтрал|нейтрал.*от штаб/.test(text))
    return {
      kind: 'chaos_neutral_ripple',
      target: 'all',
      amount: 0,
      param: 30,
    };
  if (/нейтрал|серые зон/.test(text))
    return {
      kind: 'chaos_neutral_uprising',
      target: 'all',
      amount: 0,
      param: 28,
    };
  if (/инверс|золото.*дерев|swap|бухгалтер/.test(text))
    return { kind: 'chaos_economy_swap', target: 'all', amount: 28, param: 0 };
  if (/ускор|быстр|марш|скорост/.test(text))
    return {
      kind: 'chaos_march_speed',
      target: 'all',
      amount: 30,
      param: 28,
    };
  if (/прирост|казарм|производ/.test(text))
    return {
      kind: 'chaos_production_surge',
      target: 'all',
      amount: 28,
      param: 24,
    };
  if (/захват|штурм|флаг/.test(text))
    return {
      kind: 'chaos_capture_rush',
      target: 'all',
      amount: 26,
      param: 22,
    };
  if (/щит|неуязв|купол|штаб/.test(text))
    return { kind: 'chaos_hq_shield', target: 'main', amount: 20, param: 0 };
  if (/замедл.*враг|полз|сироп/.test(text))
    return {
      kind: 'chaos_enemy_crawl',
      target: 'enemies',
      amount: 22,
      param: 6,
    };
  if (/паник|дрож|гарнизон.*враг/.test(text))
    return {
      kind: 'chaos_garrison_tremor',
      target: 'enemies',
      amount: 35,
      param: 50,
    };
  if (/кровоп|вампир|сифон.*гарниз/.test(text))
    return {
      kind: 'chaos_garrison_vamp',
      target: 'all',
      amount: 40,
      param: 30,
    };
  if (/монопол|доход.*только|враг.*0.*доход/.test(text))
    return {
      kind: 'chaos_monopoly_income',
      target: 'all',
      amount: 45,
      param: 30,
    };
  if (/зеркал|тройн.*волн|×3|×4|клон.*арми/.test(text))
    return {
      kind: 'chaos_mirror_army',
      target: 'all',
      amount: 34,
      param: 4,
    };
  if (/туман|мерца|fog|флаги.*меня/.test(text))
    return {
      kind: 'chaos_fog_flicker',
      target: 'all',
      amount: 50,
      param: 44,
    };
  if (/пушк|залп|шквал|cannon/.test(text))
    return {
      kind: 'chaos_cannon_overdrive',
      target: 'all',
      amount: 38,
      param: 36,
    };
  if (/враг.*задом|паническ.*бег|retreat/.test(text))
    return {
      kind: 'chaos_enemy_retreat',
      target: 'enemies',
      amount: 36,
      param: 7,
    };
  if (/лечат.*враг|обратн.*штурм|проклят.*крепост/.test(text))
    return {
      kind: 'chaos_enemy_fortify',
      target: 'all',
      amount: 40,
      param: 0,
    };
  if (/сжат.*врем|time.*warp|×3.*прирост/.test(text))
    return {
      kind: 'chaos_time_warp',
      target: 'all',
      amount: 44,
      param: 34,
    };
  if (/бумеранг|верни.*солдат|refund/.test(text))
    return {
      kind: 'chaos_boomerang_legions',
      target: 'all',
      amount: 42,
      param: 0,
    };
  if (/рой|улей|автовыброс|hive/.test(text))
    return {
      kind: 'chaos_hive_mind',
      target: 'all',
      amount: 36,
      param: 0,
    };
  if (/перекраск|обмен.*террит|land.*flip/.test(text))
    return {
      kind: 'chaos_land_flip',
      target: 'all',
      amount: 0,
      param: 0,
    };
  const n = prompt.match(/\d+/);
  if (n && /бойц|солдат|подкреп/.test(text))
    return {
      kind: 'reinforce',
      target: 'main',
      amount: Math.min(40, Number(n[0])),
    };
  return null;
}

export function localCustomDecree(prompt: string): Decree | null {
  if (directVictory(prompt)) return null;
  const main = textToChaos(prompt);
  if (!main) return null;
  if (isChaosKind(main.kind)) {
    const side =
      SIDE_CHAOS[Math.abs(stableSeed(prompt, 91)) % SIDE_CHAOS.length];
    const patch: Decree = {
      kind: 'batch',
      actions: [main, chaosAction(side)],
    };
    return validPlayerDecree(patch) ? patch : null;
  }
  if (!validPlayerLegacyAction(main)) return null;
  return main;
}

export function localCustomCandidate(prompt: string): DecreeCandidate | null {
  const patch = localCustomDecree(prompt);
  if (!patch) return null;
  const actions = patch.kind === 'batch' ? patch.actions : [patch];
  const main = actions[0];
  const side = actions[1];
  return {
    id: 'custom',
    title: 'Ваш приказ',
    flavor: 'Собственная формулировка лидера.',
    description: chaosEffectLabel(main),
    sideEffect: side
      ? `Довесок: ${chaosEffectLabel(side)}`
      : 'Без довеска.',
    patch,
  };
}

/** For tests / API rejection samples. */
export function isGlobalPlayerPatch(patch: Decree): boolean {
  const actions = patch.kind === 'batch' ? patch.actions : [patch];
  return actions.some(
    (a) => a.target === 'everyone' || !validPlayerDecree(a),
  );
}
