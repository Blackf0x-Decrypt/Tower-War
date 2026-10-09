import { validDebuff, type Debuff } from './magic';
import { validDecree, type Decree, type Target } from './decrees';
export type Team = 'you' | 'red' | 'purple' | 'green';
export type Kind =
  | 'tower'
  | 'supply'
  | 'relay'
  | 'gold'
  | 'lumber'
  | 'barracks';
export type Tower = {
  id: number;
  x: number;
  y: number;
  team: Team | null;
  count: number;
  kind: Kind;
  home?: Team;
  level: number;
  name: string;
  gunLevel?: number;
  shotAt?: number;
  ruinedAt?: number;
  aim?: number;
  idleAim?: number;
  idleSince?: number;
  specialty?: Specialty;
  stockGold?: number;
  stockWood?: number;
  caravanAt?: number;
};
export type Troop = {
  id: number;
  team: Team;
  from: number;
  to: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  progress: number;
  delay: number;
  speech: string;
  cargo: boolean;
  strength: number;
  elite?: boolean;
  scoutUntil?: number;
  waypoint?: { x: number; y: number };
  haul?: { gold: number; resources: number };
  stolenAt?: number;
};
export type Route = { from: number; to: number; team: Team; until: number };
export type Automation = {
  from: number;
  to: number;
  team: Team;
  nextAt: number;
  reserve?: number;
  mode?: 'assault' | 'supply' | 'excess';
};
export type Wallet = { gold: number; resources: number; earned: number };
export type Shot = {
  id: number;
  from: number;
  team: Team;
  x: number;
  y: number;
  at: number;
  sx?: number;
  sy?: number;
  target?: number;
  damage?: number;
  duration?: number;
  hit?: boolean;
};
export type Specialty = 'economy' | 'fortress' | 'swarm' | 'elite';
export type Spell = {
  team: Team;
  epoch: number;
  prompt: string;
  startedAt: number;
  castAt?: number;
  patch?: Decree;
  debuff?: Debuff | null;
  roll?: string;
  nonce?: number;
};
export type MapEvent = {
  kind: 'deposit' | 'fortress' | 'caravan';
  x: number;
  y: number;
  target?: number;
  until: number;
  claimed?: Team;
};
export type Game = {
  minesweeper?: { start: number; until: number; boards: { team: Team; finish: number; failed: boolean }[] };
  explosions?: { id: number; at: number }[];
  inputLocked?: Partial<Record<Team, boolean>>;
  players?: Partial<Record<Team, string>>;
  humans?: Team[];
  labels?: Partial<Record<Team, string>>;
  burningRule?: { team: Team; until: number };
  replayRoulette?: {
    stage: 'spinning' | 'submissions' | 'chosen';
    entries: { team: Team; text: string }[];
    selected?: number;
    until: number;
  };
  messages?: { team: Team; text: string; until: number }[];
  hideMessages?: boolean;
  announcement?: { team: Team; text: string; until: number };
  messageSentAt?: Partial<Record<Team, number>>;
  allowHeadquartersCapture?: boolean;
  shots?: Shot[];
  spell?: Spell;
  curses?: { team: Team; debuff: Debuff; at: number }[];
  event?: MapEvent;
  eventAt?: number;
  eventIndex?: number;
  towers: Tower[];
  troops: Troop[];
  routes: Route[];
  automation: Automation[];
  wallets: Record<Team, Wallet>;
  age: number;
  elapsed: number;
  botAt: number;
  supplyAt: number;
  nextId: number;
  notice: string;
  captures: number;
  orders: number;
  result: Team | 'draw' | null;
  flash: number | null;
  authority: Team | null;
  authorityEpoch: number;
  leaderSince: number;
  spellSeq?: number;
  botDecreeAt: number;
  growth: Record<Team, number>;
  speed: Record<Team, number>;
  frozen?: Partial<Record<Team, number>>;
  shielded?: Partial<Record<Team, number>>;
  decreeLog: { team: Team; text: string; at: number }[];
};
export const TEAMS = {
  you: { name: 'Синий', color: '#4295ff' },
  red: { name: 'Красный', color: '#f27160' },
  purple: { name: 'Фиолетовый', color: '#a281ed' },
  green: { name: 'Зелёный', color: '#54c886' },
};
export function playerName(g: Game, team: Team) {
  return g.players?.[team] ?? TEAMS[team].name;
}
export const TEAM_IDS = Object.keys(TEAMS) as Team[];
export const DURATION = 720;
export const DEVELOPMENT_SECONDS = 240;
export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1700;
const MOVE_SPEED = 2.2;
function worldSpan(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(
    ((ax - bx) / 100) * WORLD_WIDTH,
    ((ay - by) / 100) * WORLD_HEIGHT,
  );
}
export const KIND_LABEL: Record<Kind, string> = {
  tower: 'Форт',
  gold: 'Золотая шахта',
  lumber: 'Лесопилка',
  barracks: 'Казарма',
  supply: 'Снабжение',
  relay: 'Радиовышка',
};
const record = <T>(make: (team: Team) => T) =>
  Object.fromEntries(TEAM_IDS.map((t) => [t, make(t)])) as Record<Team, T>;
export function initialGame(): Game {
  const towers: Tower[] = [];
  TEAM_IDS.forEach((team, index) => {
    const right = index % 2 === 1,
      bottom = index >= 2;
    const pos = (x: number, y: number) => ({
      x: right ? 100 - x : x,
      y: bottom ? 100 - y : y,
    });
    const buildings: [Kind, number, number, number][] = [
      ['tower', 18, 20, 55],
      ['gold', 29, 17, 12],
      ['lumber', 15, 33, 10],
      ['barracks', 30, 32, 18],
      ['tower', 41, 23, 22],
      [index % 2 ? 'relay' : 'supply', 41, 43, 25],
    ];
    buildings.forEach(([kind, x, y, count], j) =>
      towers.push({
        id: towers.length,
        ...pos(x, y),
        kind,
        count,
        team: j === 0 ? team : null,
        home: j === 0 ? team : undefined,
        level: 1,
        name:
          j === 0
            ? `Штаб · ${TEAMS[team].name}`
            : `${KIND_LABEL[kind]} №${towers.length + 1}`,
      }),
    );
  });
  return {
    towers,
    troops: [],
    routes: [],
    automation: [],
    wallets: record(() => ({ gold: 60, resources: 40, earned: 0 })),
    age: 0,
    elapsed: 0,
    botAt: 10,
    supplyAt: 20,
    nextId: 1,
    notice: 'Захватите ближайшую шахту и лесопилку. Карту можно перетаскивать.',
    captures: 0,
    orders: 0,
    result: null,
    flash: null,
    authority: null,
    authorityEpoch: 0,
    leaderSince: 0,
    botDecreeAt: DEVELOPMENT_SECONDS + 12,
    growth: record(() => 1),
    speed: record(() => 1),
    decreeLog: [],
  };
}
export function workers(t: Tower) {
  return t.team ? Math.min(capacity(t), Math.max(0, Math.floor(t.count))) : 0;
}
export function hasCannon(t: Tower) {
  return t.ruinedAt === undefined && t.kind !== 'gold' && t.kind !== 'lumber';
}
export function cannonHeight(t: Tower) {
  return ['gold', 'lumber'].includes(t.kind) ? 55 : t.level >= 4 ? 97 : 85;
}
export function cannon(t: Tower) {
  const level = t.gunLevel ?? 1;
  return {
    level,
    damage: level * (t.specialty === 'fortress' ? 1.8 : 1),
    range: 180 + level * 30,
    interval: Math.max(0.8, 3 - level * 0.35),
  };
}
export function cannonCost(t: Tower) {
  const level = t.gunLevel ?? 1;
  return { gold: 40 * level, resources: 25 * level };
}
export function income(t: Tower) {
  const level = Math.max(1, t.level) * (t.specialty === 'economy' ? 1.75 : 1);
  return {
    gold: t.home
      ? 0.3 * level
      : t.kind === 'gold'
        ? workers(t) * 0.2 * level
        : 0,
    resources: t.home
      ? 0.2 * level
      : t.kind === 'lumber'
        ? workers(t) * 0.2 * level
        : 0,
  };
}
export function production(t: Tower) {
  return (
    (t.specialty === 'swarm' ? 1.6 : t.specialty === 'elite' ? 0.65 : 1) *
    (t.home
      ? 0.75 + t.level * 0.3
      : t.kind === 'barracks'
        ? 0.35 + t.level * 0.2
        : 0)
  );
}
export function capacity(t: Tower) {
  return 60 + t.level * 40 + (t.kind === 'tower' ? 40 : 0);
}
export function groupSize(t: Tower) {
  return Math.floor((10 + t.level * 5) * (t.specialty === 'swarm' ? 1.5 : 1));
}
export function upgradeCost(t: Tower) {
  return { gold: 50 * t.level, resources: 30 * t.level };
}
export function upgradeCannon(g: Game, id: number, actor: Team = 'you'): Game {
  const t = g.towers.find((t) => t.id === id);
  if (
    g.inputLocked?.[actor] ||
    !t ||
    !hasCannon(t) ||
    g.result ||
    t.team !== actor ||
    (t.gunLevel ?? 1) >= 5
  )
    return g;
  const cost = cannonCost(t),
    w = g.wallets[actor];
  if (w.gold < cost.gold || w.resources < cost.resources)
    return {
      ...g,
      notice: `Для пушки нужно ${cost.gold} золота и ${cost.resources} древесины.`,
    };
  return {
    ...g,
    towers: g.towers.map((b) =>
      b.id === id ? { ...b, gunLevel: (b.gunLevel ?? 1) + 1 } : b,
    ),
    wallets: {
      ...g.wallets,
      [actor]: {
        ...w,
        gold: w.gold - cost.gold,
        resources: w.resources - cost.resources,
      },
    },
    notice: humanTeams(g).includes(actor)
      ? 'Пушка улучшена: больше урон и дальность, быстрее выстрелы.'
      : g.notice,
  };
}
export function teamIncome(g: Game, team: Team) {
  if ((g.frozen?.[team] ?? 0) > g.age) return { gold: 0, resources: 0 };
  return g.towers
    .filter((t) => t.team === team)
    .reduce(
      (sum, t) => ({
        gold:
          sum.gold +
          income(t).gold *
            modifier(g, team, 'income') *
            (g.event?.kind === 'deposit' && g.event.target === t.id ? 3 : 1),
        resources:
          sum.resources +
          income(t).resources *
            modifier(g, team, 'income') *
            (g.event?.kind === 'deposit' && g.event.target === t.id ? 3 : 1),
      }),
      { gold: 0, resources: 0 },
    );
}
export function dispatch(
  g: Game,
  from: number,
  to: number,
  fraction: number,
  cargo = false,
  limit = Infinity,
): Game {
  const source = g.towers.find((t) => t.id === from),
    target = g.towers.find((t) => t.id === to);
  if (
    !source?.team ||
    !target ||
    target.ruinedAt !== undefined ||
    source.ruinedAt !== undefined ||
    from === to ||
    g.result ||
    (g.frozen?.[source.team] ?? 0) > g.age
  )
    return g;
  const amount = cargo
    ? 1
    : Math.floor(
        Math.min(limit, source.count * Math.min(1, Math.max(0, fraction))),
      );
  if (amount < 1) return g;
  const team = source.team,
    visualCount = Math.min(amount, 24);
  const troops = Array.from(
    { length: visualCount },
    (_, i): Troop => ({
      id: g.nextId + i,
      strength: cargo
        ? 8 + source.level * 2
        : Math.floor(amount / visualCount) + (i < amount % visualCount ? 1 : 0),
      team,
      from,
      to,
      x: source.x,
      y: source.y,
      sx: source.x,
      sy: source.y,
      progress: 0,
      delay: i * 0.2,
      speech:
        i === 0
          ? cargo
            ? 'Подкрепление в пути!'
            : target.team === team
              ? 'Держитесь, мы идём!'
              : target.kind === 'gold'
                ? 'Золото будет нашим!'
                : target.kind === 'lumber'
                  ? 'Нужна древесина!'
                  : 'Выдвигаемся!'
          : '',
      cargo,
      elite: source.specialty === 'elite',
    }),
  );
  return {
    ...g,
    nextId: g.nextId + visualCount,
    towers: cargo
      ? g.towers
      : g.towers.map((t) =>
          t.id === from ? { ...t, count: t.count - amount } : t,
        ),
    troops: [...g.troops, ...troops],
    routes: [
      ...g.routes.filter((r) => r.from !== from || r.to !== to),
      {
        from,
        to,
        team,
        until:
          g.age +
          visualCount * 0.2 +
          Math.hypot(source.x - target.x, source.y - target.y) / MOVE_SPEED +
          1,
      },
    ],
    orders: g.orders + (!cargo && humanTeams(g).includes(team) ? 1 : 0),
  };
}
export function humanTeams(g: Game): Team[] {
  return g.humans ?? ['you'];
}
export function sendArmy(
  g: Game,
  from: number,
  to: number,
  fraction: number,
  actor: Team = 'you',
): Game {
  if (
    g.inputLocked?.[actor] ||
    g.towers.find((t) => t.id === from)?.team !== actor
  )
    return g;
  const next = dispatch(g, from, to, fraction);
  return next === g
    ? g
    : {
        ...next,
        notice: 'Отряд в пути. Перетаскивайте карту, чтобы следить за фронтом.',
      };
}
function recallable(p: Troop, actor: Team) {
  return (
    p.team === actor &&
    !p.cargo &&
    !p.haul &&
    !p.scoutUntil &&
    p.progress < 1
  );
}
export function recallTroops(
  g: Game,
  actor: Team,
  from: number | null,
  id: number | null,
): Game {
  if (g.inputLocked?.[actor] || g.result) return g;
  const hits = g.troops.filter((p) => {
    if (!recallable(p, actor)) return false;
    if (id !== null) return p.id === id;
    return from !== null && p.from === from;
  });
  if (!hits.length) return g;
  const back = new Map<number, number>();
  for (const p of hits) {
    const source = g.towers.find((t) => t.id === p.from);
    if (!source || source.team !== actor || source.ruinedAt !== undefined)
      continue;
    back.set(source.id, (back.get(source.id) ?? 0) + p.strength);
  }
  const gone = new Set(hits.map((p) => p.id));
  const troops = g.troops.filter((p) => !gone.has(p.id));
  const stillMarching = (fromId: number, toId: number) =>
    troops.some(
      (p) =>
        p.team === actor &&
        p.from === fromId &&
        p.to === toId &&
        !p.cargo &&
        !p.haul &&
        !p.scoutUntil &&
        p.progress < 1,
    );
  return {
    ...g,
    towers: g.towers.map((t) => {
      const add = back.get(t.id);
      return add === undefined
        ? t
        : { ...t, count: Math.min(1e9, t.count + add) };
    }),
    troops,
    routes: g.routes.filter(
      (r) => r.team !== actor || stillMarching(r.from, r.to),
    ),
    notice:
      back.size > 0
        ? 'Войска вернулись в здание.'
        : 'Отряд снят с дороги. Здание уже не ваше.',
  };
}
export function upgrade(g: Game, id: number, actor: Team = 'you'): Game {
  const t = g.towers.find((t) => t.id === id);
  if (
    g.inputLocked?.[actor] ||
    g.result ||
    !t ||
    t.team !== actor ||
    t.level >= 5
  )
    return g;
  const cost = upgradeCost(t),
    wallet = g.wallets[actor];
  if (wallet.gold < cost.gold || wallet.resources < cost.resources)
    return humanTeams(g).includes(actor)
      ? {
          ...g,
          notice: `Нужно ${cost.gold} золота и ${cost.resources} древесины.`,
        }
      : g;
  return {
    ...g,
    wallets: {
      ...g.wallets,
      [actor]: {
        ...wallet,
        gold: wallet.gold - cost.gold,
        resources: wallet.resources - cost.resources,
      },
    },
    towers: g.towers.map((t) =>
      t.id === id ? { ...t, level: t.level + 1 } : t,
    ),
    notice: humanTeams(g).includes(actor)
      ? `${t.name}: уровень ${t.level + 1}. Добыча, вместимость и размер групп увеличены.`
      : g.notice,
  };
}
export function setAutomation(
  g: Game,
  from: number,
  to: number | null,
  actor: Team = 'you',
): Game {
  const source = g.towers.find((t) => t.id === from);
  if (
    g.result ||
    g.inputLocked?.[actor] ||
    source?.team !== actor ||
    to === from ||
    (to !== null && !g.towers.some((t) => t.id === to))
  )
    return g;
  const automation = g.automation.filter((a) => a.from !== from);
  if (to !== null)
    automation.push({
      from,
      to,
      team: actor,
      nextAt: g.age + 1,
      reserve: ['gold', 'lumber'].includes(source.kind) ? 30 : 5,
      mode: g.towers[to].team === actor ? 'supply' : 'assault',
    });
  return {
    ...g,
    automation,
    notice: humanTeams(g).includes(actor)
      ? to === null
        ? 'Автомаршрут отключён.'
        : `Маршрут → №${to + 1}`
      : g.notice,
  };
}
export const SPECIALTIES = {
  economy: 'Добыча ×1.75',
  fortress: 'Укрепление',
  swarm: 'Массовый набор',
  elite: 'Элитные бойцы',
};
export function specialties(t: Tower): Specialty[] {
  return t.home || t.kind === 'barracks'
    ? ['swarm', 'elite']
    : ['gold', 'lumber'].includes(t.kind)
      ? ['economy', 'fortress']
      : ['fortress'];
}
export function specialize(
  g: Game,
  id: number,
  choice: Specialty,
  actor: Team = 'you',
): Game {
  const t = g.towers.find((t) => t.id === id),
    w = g.wallets[actor];
  if (
    g.inputLocked?.[actor] ||
    g.result ||
    !t ||
    t.team !== actor ||
    t.level < 2 ||
    t.specialty ||
    !specialties(t).includes(choice) ||
    w.gold < 80 ||
    w.resources < 60
  )
    return g;
  return {
    ...g,
    towers: g.towers.map((b) =>
      b.id === id ? { ...b, specialty: choice } : b,
    ),
    wallets: {
      ...g.wallets,
      [actor]: { ...w, gold: w.gold - 80, resources: w.resources - 60 },
    },
    notice: humanTeams(g).includes(actor) ? SPECIALTIES[choice] : g.notice,
  };
}
export function configureAutomation(
  g: Game,
  from: number,
  mode: 'assault' | 'supply' | 'excess',
  reserve: number,
  actor: Team = 'you',
): Game {
  if (
    g.inputLocked?.[actor] ||
    g.result ||
    !Number.isFinite(reserve) ||
    !['assault', 'supply', 'excess'].includes(mode)
  )
    return g;
  return {
    ...g,
    automation: g.automation.map((a) =>
      a.from === from && a.team === actor
        ? {
            ...a,
            mode,
            reserve: Math.max(0, Math.min(1000, Math.floor(reserve))),
          }
        : a,
    ),
  };
}
export function modifier(
  g: Game,
  team: Team,
  stat: Debuff['effects'][number]['stat'],
) {
  return (g.curses ?? [])
    .filter((c) => c.team === team)
    .reduce(
      (n, c) =>
        n *
        c.debuff.effects
          .filter((e) => e.stat === stat && c.at + e.duration > g.age)
          .reduce((m, e) => m * e.factor, 1),
      1,
    );
}
export function messageOpportunity(g: Game, team: Team = 'you') {
  const cycle = Math.floor((g.age - 45) / 80);
  const sent = g.messageSentAt?.[team];
  return (
    !g.result &&
    !g.hideMessages &&
    !g.inputLocked?.[team] &&
    g.towers.some((t) => t.home && t.team === team) &&
    !g.spell &&
    g.age >= 45 &&
    (g.age - 45) % 80 < 20 &&
    (sent === undefined || Math.floor((sent - 45) / 80) !== cycle)
  );
}
export function sendMessage(g: Game, team: Team, text: string): Game {
  if (
    g.inputLocked?.[team] ||
    g.result ||
    g.hideMessages ||
    !text.trim() ||
    !g.towers.some((t) => t.home && t.team === team)
  )
    return g;
  return {
    ...g,
    messages: [
      ...(g.messages ?? []).filter((m) => m.team !== team && m.until > g.age),
      { team, text: text.trim().slice(0, 350), until: g.age + 10 },
    ],
    messageSentAt: { ...g.messageSentAt, [team]: g.age },
  };
}
export function announcePrompt(g: Game, team: Team, text: string): Game {
  return {
    ...g,
    announcement: { team, text: text.slice(0, 350), until: g.age + 10 },
  };
}
export function startSpell(
  g: Game,
  team: Team,
  prompt: string,
  roll = 'disabled',
): Game {
  if (
    g.inputLocked?.[team] ||
    g.result ||
    g.spell ||
    g.age < DEVELOPMENT_SECONDS ||
    !actingLeader(g, team)
  )
    return g;
  const seated = refreshAuthority(g);
  if (seated.result || seated.spell || !actingLeader(seated, team)) return g;
  const nonce = (seated.spellSeq ?? 0) + 1;
  return {
    ...announcePrompt(seated, team, prompt),
    spellSeq: nonce,
    spell: {
      team,
      epoch: seated.authorityEpoch,
      prompt: prompt.slice(0, 350),
      startedAt: seated.age,
      roll,
      nonce,
    },
  };
}
export function readySpell(
  g: Game,
  patch: Decree,
  epoch: number,
  debuff: Debuff | null,
  roll: string,
): Game {
  if (
    !g.spell ||
    g.spell.epoch !== epoch ||
    g.authorityEpoch !== epoch ||
    !actingLeader(g, g.spell.team) ||
    !validDecree(patch) ||
    (debuff !== null && !validDebuff(debuff))
  )
    return g;
  return {
    ...g,
    spell: {
      ...g.spell,
      patch,
      debuff,
      roll,
      castAt:
        Math.max(g.age, g.spell.startedAt + (roll === 'disabled' ? 0 : 3)) + 6,
    },
    notice:
      g.spell && humanTeams(g).includes(g.spell.team)
        ? debuff
          ? `${debuff.title}: ${debuff.description}`
          : 'Приказ готовится · удержите лидерство 6 с'
        : g.notice,
  };
}
export function sendScout(
  g: Game,
  from: number,
  x: number,
  y: number,
  actor: Team = 'you',
): Game {
  const t = g.towers.find((t) => t.id === from),
    w = g.wallets[actor];
  if (
    g.inputLocked?.[actor] ||
    g.result ||
    !t ||
    t.team !== actor ||
    w.gold < 20 ||
    w.resources < 10 ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    g.troops.filter((p) => p.team === actor && p.scoutUntil).length >= 3
  )
    return g;
  return {
    ...g,
    nextId: g.nextId + 1,
    wallets: {
      ...g.wallets,
      [actor]: { ...w, gold: w.gold - 20, resources: w.resources - 10 },
    },
    troops: [
      ...g.troops,
      {
        id: g.nextId,
        team: actor,
        from,
        to: from,
        x: t.x,
        y: t.y,
        sx: t.x,
        sy: t.y,
        progress: 0,
        delay: 0,
        speech: 'Разведаю местность!',
        cargo: false,
        strength: 3,
        scoutUntil: g.age + 120,
        waypoint: {
          x: Math.max(0, Math.min(100, x)),
          y: Math.max(0, Math.min(100, y)),
        },
      },
    ],
    notice: humanTeams(g).includes(actor)
      ? 'Разведчик в пути · обзор на 2 минуты'
      : g.notice,
  };
}
function earnedRank(g: Game) {
  return TEAM_IDS.filter((team) => g.towers.some((t) => t.team === team))
    .map((team) => ({ team, n: Math.floor(g.wallets[team].earned) }))
    .sort((a, b) => b.n - a.n);
}
export function economicLeader(g: Game): Team | null {
  const ranked = earnedRank(g);
  return ranked.length && (ranked.length === 1 || ranked[0].n > ranked[1].n)
    ? ranked[0].team
    : null;
}
export function leader(g: Game): Team | null {
  return g.age < DEVELOPMENT_SECONDS ? null : economicLeader(g);
}
function tiedForLead(g: Game, team: Team) {
  const ranked = earnedRank(g);
  const row = ranked.find((item) => item.team === team);
  return !!row && row.n === ranked[0].n;
}
function actingLeader(g: Game, team: Team) {
  return g.authority === team || leader(g) === team;
}
export function refreshAuthority(g: Game): Game {
  const next = leader(g);
  if (next === g.authority) return g;
  if (
    next === null &&
    g.authority &&
    g.age >= DEVELOPMENT_SECONDS &&
    tiedForLead(g, g.authority)
  )
    return g;
  return {
    ...g,
    authority: next,
    authorityEpoch: g.authorityEpoch + 1,
    leaderSince: g.age,
  };
}
export function tick(previous: Game, dt = 0.05): Game {
  if (previous.result) return previous;
  let g: Game = {
    ...previous,
    age: previous.age + dt,
    messages: (previous.messages ?? []).filter(
      (m) => m.until > previous.age + dt,
    ),
    announcement:
      previous.announcement && previous.announcement.until > previous.age + dt
        ? previous.announcement
        : undefined,
    elapsed: previous.elapsed + dt,
    flash: null,
    shots: (previous.shots ?? [])
      .filter((s) => previous.age - s.at < (s.duration ?? 0.4) + 0.3)
      .map((s) => ({ ...s })),
    curses: (previous.curses ?? []).filter((c) =>
      c.debuff.effects.some((e) => c.at + e.duration > previous.age),
    ),
    towers: previous.towers.map((t) => ({ ...t })),
    wallets: record((team) => ({ ...previous.wallets[team] })),
    troops: [],
    routes: previous.routes.filter((r) => r.until > previous.age),
    automation: previous.automation
      .filter(
        (a) => previous.towers.find((t) => t.id === a.from)?.team === a.team,
      )
      .map((a) => ({ ...a })),
  };
  for (const t of g.towers) {
    if (
      g.burningRule &&
      g.burningRule.until > g.age &&
      t.team === g.burningRule.team &&
      t.kind === 'lumber' &&
      t.ruinedAt === undefined
    ) {
      t.ruinedAt = g.age;
      t.team = null;
      t.count = 0;
      t.stockGold = 0;
      t.stockWood = 0;
    }
    if (!t.team || (g.frozen?.[t.team] ?? 0) > g.age) continue;
    const w = g.wallets[t.team],
      earn = income(t);
    const efficiency =
      modifier(g, t.team, 'income') *
      (g.event?.kind === 'deposit' &&
      g.event.target === t.id &&
      g.event.until > g.age
        ? 3
        : 1);
    if (t.home) {
      w.gold += earn.gold * dt * efficiency;
      w.resources += earn.resources * dt * efficiency;
      w.earned += (earn.gold + earn.resources) * dt * efficiency;
    } else {
      t.stockGold = (t.stockGold ?? 0) + earn.gold * dt * efficiency;
      t.stockWood = (t.stockWood ?? 0) + earn.resources * dt * efficiency;
    }
    const rate =
      production(t) * g.growth[t.team] * modifier(g, t.team, 'growth');
    if (t.count < capacity(t))
      t.count = Math.min(capacity(t), t.count + rate * dt);
  }
  const incoming = previous.troops.map((p) => ({ ...p }));
  for (const shot of g.shots ?? []) {
    const tracked = incoming.find((p) => p.id === shot.target);
    if (!shot.hit && tracked) {
      shot.x = tracked.x;
      shot.y = tracked.y;
    }
    if (!shot.hit && g.age >= shot.at + (shot.duration ?? 0.4)) {
      shot.hit = true;
      const victim = incoming.find((p) => p.id === shot.target);
      if (victim && victim.team !== shot.team)
        victim.strength = Math.max(
          0,
          victim.strength - (shot.damage ?? 1) * (victim.elite ? 0.6 : 1),
        );
    }
  }
  for (const t of g.towers) {
    if (
      !t.team ||
      !hasCannon(t) ||
      t.count < 1 ||
      (g.frozen?.[t.team] ?? 0) > g.age
    )
      continue;
    const gun = cannon(t);
    const distance = (p: Troop) =>
      Math.hypot(
        ((p.x - t.x) * WORLD_WIDTH) / 100,
        ((p.y - t.y) * WORLD_HEIGHT) / 100,
      );
    const target = incoming
      .filter(
        (p) =>
          p.team !== t.team &&
          p.delay <= 0 &&
          p.progress > 0 &&
          p.strength > 0 &&
          distance(p) <= gun.range,
      )
      .sort((a, b) => distance(a) - distance(b))[0];
    if (!target) {
      if (t.idleSince === undefined) {
        t.idleSince = g.age;
        t.idleAim = t.aim ?? (t.id * 47) % 360;
      }
      t.aim = (t.idleAim ?? 0) + 18 * Math.sin((g.age - t.idleSince) * 0.55);
      continue;
    }
    t.idleSince = undefined;
    const desiredAim =
      (Math.atan2(
        (target.y - t.y) * WORLD_HEIGHT + cannonHeight(t) * 100,
        (target.x - t.x) * WORLD_WIDTH,
      ) *
        180) /
      Math.PI;
    const turn =
      t.aim === undefined
        ? 0
        : ((((desiredAim - t.aim + 540) % 360) + 360) % 360) - 180;
    t.aim =
      t.aim === undefined
        ? desiredAim
        : t.aim + Math.max(-270 * dt, Math.min(270 * dt, turn));
    if ((t.shotAt ?? 0) > g.age || Math.abs(turn) > 270 * dt + 5) continue;
    t.shotAt =
      g.age + gun.interval / Math.max(0.05, modifier(g, t.team, 'cannons'));
    const angle = (t.aim * Math.PI) / 180;
    const sx = t.x + ((Math.cos(angle) * 58) / WORLD_WIDTH) * 100,
      sy =
        t.y -
        (cannonHeight(t) / WORLD_HEIGHT) * 100 +
        ((Math.sin(angle) * 58) / WORLD_HEIGHT) * 100;
    g.shots!.push({
      id: g.nextId++,
      from: t.id,
      team: t.team,
      x: target.x,
      y: target.y,
      at: g.age,
      sx,
      sy,
      target: target.id,
      damage: gun.damage,
      duration: Math.max(0.25, distance(target) / 500),
    });
  }
  for (const old of incoming) {
    if (old.strength <= 0) continue;
    const p = { ...old };
    if ((g.frozen?.[p.team] ?? 0) > g.age) {
      g.troops.push(p);
      continue;
    }
    if (p.delay > 0) {
      p.delay -= dt;
      g.troops.push(p);
      continue;
    }
    if (p.scoutUntil) {
      if (g.age > p.scoutUntil) continue;
      const dest = p.waypoint!;
      const d = Math.hypot(dest.x - p.sx, dest.y - p.sy);
      p.progress = Math.min(
        1,
        p.progress +
          (dt *
            MOVE_SPEED *
            1.8 *
            g.speed[p.team] *
            modifier(g, p.team, 'speed')) /
            Math.max(1, d),
      );
      p.x = p.sx + (dest.x - p.sx) * p.progress;
      p.y = p.sy + (dest.y - p.sy) * p.progress;
      g.troops.push(p);
      continue;
    }
    if (p.haul) {
      const thief = incoming.find(
        (a) =>
          !a.cargo &&
          !a.scoutUntil &&
          a.team !== p.team &&
          a.delay <= 0 &&
          a.strength >= 3 &&
          Math.hypot(a.x - p.x, a.y - p.y) < 1.5 &&
          g.towers.some((t) => t.home && t.team === a.team),
      );
      if (thief && g.age - (p.stolenAt ?? -10) > 5) {
        p.team = thief.team;
        p.stolenAt = g.age;
        p.progress = 0;
        p.sx = p.x;
        p.sy = p.y;
        p.speech = 'Караван перехвачен!';
      }
      const current = g.towers.find((t) => t.id === p.to);
      const held =
        current &&
        current.home &&
        current.team === p.team &&
        current.ruinedAt === undefined;
      if (!held) {
        const home = g.towers
          .filter(
            (t) => t.home && t.team === p.team && t.ruinedAt === undefined,
          )
          .sort(
            (a, b) =>
              worldSpan(a.x, a.y, p.x, p.y) - worldSpan(b.x, b.y, p.x, p.y),
          )[0];
        if (!home) continue;
        if (p.to !== home.id) {
          p.to = home.id;
          p.sx = p.x;
          p.sy = p.y;
          p.progress = 0;
        }
      }
    }
    const target = g.towers.find((t) => t.id === p.to);
    if (!target || target.ruinedAt !== undefined) continue;
    const boost = g.towers.some((t) => t.kind === 'relay' && t.team === p.team)
      ? 1.4
      : 1;
    const span = p.haul
      ? worldSpan(target.x, target.y, p.sx, p.sy)
      : Math.hypot(target.x - p.sx, target.y - p.sy);
    const pace = p.haul
      ? MOVE_SPEED * ((WORLD_WIDTH + WORLD_HEIGHT) / 200)
      : MOVE_SPEED;
    p.progress +=
      (dt * pace * boost * g.speed[p.team] * modifier(g, p.team, 'speed')) /
      Math.max(1, span);
    p.x = p.sx + (target.x - p.sx) * Math.min(1, p.progress);
    p.y = p.sy + (target.y - p.sy) * Math.min(1, p.progress);
    if (p.progress < 1) {
      g.troops.push(p);
      continue;
    }
    if (p.haul) {
      if (target.team === p.team) {
        const w = g.wallets[p.team];
        w.gold += p.haul.gold;
        w.resources += p.haul.resources;
        w.earned += p.haul.gold + p.haul.resources;
      }
      continue;
    }
    if (target.team === p.team)
      target.count = Math.min(1e9, target.count + p.strength);
    else if (target.team && (g.shielded?.[target.team] ?? 0) > g.age) {
    } else if (target.home && !g.allowHeadquartersCapture)
      target.count = Math.max(0, target.count - p.strength * (p.elite ? 2 : 1));
    else {
      target.count -=
        (p.strength * (p.elite ? 2 : 1)) /
        ((1 + (target.level - 1) * 0.12) *
          (target.specialty === 'fortress' ? 1.5 : 1));
      if (target.count < 0) {
        target.team = p.team;
        if (target.home) target.home = p.team;
        target.count = Math.abs(target.count);
        g.flash = target.id;
        if (
          g.event?.kind === 'fortress' &&
          g.event.target === target.id &&
          !g.event.claimed &&
          g.event.until > g.age
        ) {
          target.count += 50;
          g.event = { ...g.event, claimed: p.team };
          g.notice = 'Древний форт: 50 бойцов присоединились к захватчику!';
        }
        if (humanTeams(g).includes(p.team)) {
          g.captures++;
          g.notice = `${target.name} захвачен. ${target.kind === 'gold' ? 'Шахта приносит золото.' : target.kind === 'lumber' ? 'Лесопилка приносит древесину.' : target.kind === 'barracks' ? 'Казарма набирает бойцов.' : 'Настройте улучшения и автомаршрут.'}`;
        }
      }
    }
  }
  for (const route of g.automation) {
    if (route.nextAt > g.age || (g.frozen?.[route.team] ?? 0) > g.age) continue;
    route.nextAt = g.age + 6;
    const source = g.towers.find((t) => t.id === route.from);
    const target = g.towers.find((t) => t.id === route.to);
    const reserve =
      route.mode === 'excess'
        ? Math.max(route.reserve ?? 5, capacity(source ?? g.towers[0]) * 0.75)
        : (route.reserve ?? 5);
    const inFlight = g.troops
      .filter(
        (p) =>
          p.team === route.team &&
          p.to === route.to &&
          !p.cargo &&
          !p.scoutUntil,
      )
      .reduce((n, p) => n + p.strength, 0);
    const need =
      route.mode === 'supply' && target?.team === route.team
        ? Math.max(0, 50 - target.count - inFlight)
        : Infinity;
    if (source?.team === route.team && source.count > reserve)
      g = dispatch(
        g,
        source.id,
        route.to,
        1,
        false,
        Math.min(groupSize(source), source.count - reserve, need),
      );
  }
  for (const t of g.towers) {
    if (
      !t.team ||
      (t.caravanAt ?? 12) > g.age ||
      (t.stockGold ?? 0) + (t.stockWood ?? 0) < 5
    )
      continue;
    const home = g.towers
      .filter((h) => h.team === t.team && h.home && h.ruinedAt === undefined)
      .sort(
        (a, b) =>
          worldSpan(a.x, a.y, t.x, t.y) - worldSpan(b.x, b.y, t.x, t.y),
      )[0];
    if (!home) continue;
    g.troops.push({
      id: g.nextId++,
      team: t.team,
      from: t.id,
      to: home.id,
      x: t.x,
      y: t.y,
      sx: t.x,
      sy: t.y,
      progress: 0,
      delay: 0,
      speech: 'Везём добычу!',
      cargo: true,
      strength: 8 + t.level * 2,
      haul: { gold: t.stockGold ?? 0, resources: t.stockWood ?? 0 },
    });
    t.stockGold = 0;
    t.stockWood = 0;
    t.caravanAt = g.age + 12;
  }
  if (g.age >= (g.eventAt ?? 75)) {
    const index = g.eventIndex ?? 0,
      kind = (['deposit', 'fortress', 'caravan'] as const)[index % 3];
    const candidates = g.towers.filter((t) =>
      kind === 'deposit'
        ? ['gold', 'lumber'].includes(t.kind)
        : !t.home && !t.team,
    );
    const target = candidates[index % candidates.length];
    g.event = {
      kind: target ? kind : 'caravan',
      target: target?.id,
      x: target?.x ?? 50,
      y: target?.y ?? 50,
      until: g.age + 50,
    };
    g.eventIndex = index + 1;
    g.eventAt = g.age + 85;
    g.notice =
      kind === 'deposit'
        ? 'Богатая жила: добыча ×3 на 50 с'
        : kind === 'fortress'
          ? 'Захватите древний форт: +50 бойцов'
          : 'Золотой караван в центре: перехватите 150 золота';
  }
  if (g.event) {
    g.event = { ...g.event };
    if (g.event.until <= g.age) g.event = undefined;
    else if (g.event.kind === 'caravan' && !g.event.claimed) {
      g.event.x = 35 + (50 - (g.event.until - g.age)) * 0.6;
      const taker = g.troops.find(
        (p) =>
          p.delay <= 0 && Math.hypot(p.x - g.event!.x, p.y - g.event!.y) < 3,
      );
      if (taker) {
        g.wallets[taker.team].gold += 150;
        g.wallets[taker.team].earned += 150;
        g.event.claimed = taker.team;
        g.notice = `${playerName(g, taker.team)}: караван +150 золота`;
      }
    }
  }
  if (g.age >= g.botAt) {
    g.botAt = g.age + 10;
    const people = new Set(humanTeams(g));
    for (const team of TEAM_IDS.filter((t) => !people.has(t))) {
      if (g.inputLocked?.[team] || (g.frozen?.[team] ?? 0) > g.age) continue;
      const buildings = g.towers.filter((t) => t.team === team);
      const toUpgrade = [...buildings]
        .filter((t) => t.level < 5)
        .sort(
          (a, b) => a.level + (a.home ? 1 : 0) - (b.level + (b.home ? 1 : 0)),
        )[0];
      if (toUpgrade) g = upgrade(g, toUpgrade.id, team);
      const branch = g.towers.find(
        (t) => t.team === team && t.level >= 2 && !t.specialty,
      );
      if (branch) g = specialize(g, branch.id, specialties(branch)[0], team);
      if (
        buildings[0] &&
        g.age > 60 &&
        !g.troops.some((p) => p.team === team && p.scoutUntil)
      )
        g = sendScout(g, buildings[0].id, 50, 50, team);
      const armed = buildings.find(
        (t) =>
          hasCannon(t) &&
          (t.gunLevel ?? 1) < 3 &&
          g.troops.some((p) => p.team !== team && p.to === t.id),
      );
      if (armed) {
        const price = cannonCost(armed);
        if (
          g.wallets[team].gold >= price.gold &&
          g.wallets[team].resources >= price.resources
        )
          g = upgradeCannon(g, armed.id, team);
      }
      const source = g.towers
        .filter((t) => t.team === team && t.count >= 18)
        .sort((a, b) => b.count - a.count)[0];
      if (!source) continue;
      const target = g.towers
        .filter((t) => t.team !== team && !t.home)
        .sort(
          (a, b) =>
            a.count +
            Math.hypot(a.x - source.x, a.y - source.y) * 1.8 -
            (['gold', 'lumber'].includes(a.kind) ? 12 : 0) -
            (b.count +
              Math.hypot(b.x - source.x, b.y - source.y) * 1.8 -
              (['gold', 'lumber'].includes(b.kind) ? 12 : 0)),
        )[0];
      if (target && source.count * 0.7 > target.count * 0.8)
        g = dispatch(g, source.id, target.id, 0.7);
      const producer = buildings.find(
        (t) =>
          (t.home || t.kind === 'barracks') &&
          !g.automation.some((a) => a.from === t.id),
      );
      const front = buildings
        .filter((t) => !t.home && t.kind !== 'barracks')
        .sort((a, b) => b.count - a.count)[0];
      if (producer && front) g = setAutomation(g, producer.id, front.id, team);
    }
  }
  g = refreshAuthority(g);
  if (
    g.authority &&
    !humanTeams(g).includes(g.authority) &&
    g.age - g.leaderSince >= 6 &&
    g.age >= g.botDecreeAt &&
    !g.spell
  ) {
    g = startSpell(g, g.authority, 'Штабу +35 бойцов');
    g = readySpell(
      g,
      { kind: 'reinforce', target: 'main', amount: 35 },
      g.authorityEpoch,
      null,
      'disabled',
    );
    g.botDecreeAt = g.age + 18;
  }
  if (g.spell) {
    const spell = g.spell;
    if (g.authority !== spell.team || g.authorityEpoch !== spell.epoch) {
      g.spell = undefined;
      g.notice = 'Лидер сменился — заклинание сорвано!';
    } else if (
      spell.castAt !== undefined &&
      g.age >= spell.castAt &&
      spell.patch
    ) {
      g = applyDecree(
        { ...g, spell: undefined },
        spell.team,
        spell.patch,
        spell.epoch,
      );
      if (spell.debuff) {
        g.curses = [
          ...(g.curses ?? []),
          { team: spell.team, debuff: spell.debuff, at: g.age },
        ];
        g.notice += ` Побочный эффект: ${spell.debuff.title}.`;
      }
    } else if (!spell.patch && g.age - spell.startedAt > 25) {
      g.spell = undefined;
      g.notice = 'Время ожидания приказа истекло';
    }
  }
  if (g.age >= DEVELOPMENT_SECONDS) {
    const alive = TEAM_IDS.filter(
      (team) =>
        g.towers.some((t) => t.team === team) ||
        g.troops.some((p) => p.team === team),
    );
    if (alive.length === 1) g.result = alive[0];
  }
  if (g.elapsed >= DURATION - 1e-4 && !g.result)
    g.result = economicLeader(g) ?? 'draw';
  return g;
}
function matches(t: Tower, target: Target, actor: Team): boolean {
  if (typeof target === 'number') return t.id === target;
  if (target === 'everyone') return true;
  if (target === 'neutral') return !t.team;
  if (target === 'enemies') return !!t.team && t.team !== actor;
  if (target === 'main') return t.team === actor && !!t.home;
  return t.team === (target === 'all' ? actor : target);
}
export function applyDecree(
  g: Game,
  team: Team,
  p: Decree,
  epoch: number,
): Game {
  if (g.age < DEVELOPMENT_SECONDS)
    return { ...g, notice: 'Право промпта откроется после 4 минут развития.' };
  if (
    g.result ||
    !validDecree(p) ||
    !actingLeader(g, team) ||
    g.authorityEpoch !== epoch
  )
    return {
      ...g,
      notice: 'Право перешло другому лидеру. Промпт не применён.',
    };
  const actions = p.kind === 'batch' ? p.actions : [p];
  const next: Game = {
    ...g,
    towers: g.towers.map((t) => ({ ...t })),
    troops: g.troops.map((t) => ({ ...t })),
    routes: g.routes.map((r) => ({ ...r })),
    growth: { ...g.growth },
    speed: { ...g.speed },
    frozen: { ...g.frozen },
    shielded: { ...g.shielded },
    wallets: record((t) => ({ ...g.wallets[t] })),
    automation: g.automation.map((a) => ({ ...a })),
  };
  const log: string[] = [];
  for (const a of actions) {
    const targets = next.towers.filter((t) => matches(t, a.target, team));
    const affected = (Object.keys(TEAMS) as Team[]).filter(
      (t) =>
        a.target === 'everyone' ||
        (a.target === 'enemies' && t !== team) ||
        a.target === t ||
        ((a.target === 'all' || a.target === 'main') && t === team) ||
        (typeof a.target === 'number' && targets.some((x) => x.team === t)),
    );
    const targetIDs = new Set(targets.map((t) => t.id));
    const troopMatches = (p: Troop) =>
      typeof a.target === 'number' || a.target === 'main'
        ? targetIDs.has(p.from)
        : affected.includes(p.team);
    if (a.kind === 'messages') {
      next.hideMessages = a.amount === 0;
      next.messages = [];
      log.push(a.amount === 0 ? 'Сообщения отключены' : 'Сообщения включены');
    } else if (a.kind === 'transfer' || a.kind === 'capture') {
      for (const t of targets) {
        t.team = team;
        if (t.home) t.home = team;
      }
      if (a.kind === 'transfer')
        for (const troop of next.troops)
          if (troopMatches(troop)) troop.team = team;
      next.routes = next.routes.filter((r) => !affected.includes(r.team));
      log.push(
        `Под контроль перешли здания (${targets.length})${a.kind === 'transfer' ? ' и бойцы' : ''}`,
      );
    } else if (a.kind === 'destroy') {
      for (const t of targets) {
        t.team = null;
        t.count = 0;
        t.home = undefined;
        t.level = 1;
      }
      next.troops = next.troops.filter((p) => !troopMatches(p));
      next.routes = next.routes.filter((r) => !affected.includes(r.team));
      log.push('Указанная армия уничтожена, укрепления обнулены');
    } else if (a.kind === 'growth' || a.kind === 'speed') {
      for (const who of affected) next[a.kind][who] = a.amount;
      log.push(
        `${a.kind === 'speed' ? 'Скорость' : 'Прирост'} выбранных команд ×${a.amount}`,
      );
    } else if (a.kind === 'freeze' || a.kind === 'shield') {
      const field = a.kind === 'freeze' ? 'frozen' : 'shielded';
      for (const who of affected) next[field]![who] = next.age + a.amount;
      log.push(
        `${a.kind === 'freeze' ? 'Заморозка' : 'Неуязвимость'} на ${a.amount} с`,
      );
    } else if (a.kind === 'gold' || a.kind === 'resources') {
      for (const who of affected)
        next.wallets[who][a.kind] = Math.max(
          0,
          Math.min(1e9, next.wallets[who][a.kind] + a.amount),
        );
      log.push(`${a.kind === 'gold' ? 'Золото' : 'Древесина'}: +${a.amount}`);
    } else if (a.kind === 'time') {
      next.elapsed = Math.max(0, DURATION - a.amount);
      log.push(`До конца матча ${a.amount} с`);
    } else if (a.kind === 'upgrade') {
      for (const t of targets)
        t.level = Math.max(1, Math.min(10, Math.floor(a.amount)));
      log.push(`Уровень зданий: ${a.amount}`);
    } else {
      for (const t of targets)
        t.count = Math.max(
          0,
          Math.min(
            1e9,
            a.kind === 'set'
              ? a.amount
              : a.kind === 'multiply'
                ? t.count * a.amount
                : t.count + a.amount,
          ),
        );
      if (a.kind === 'multiply')
        for (const troop of next.troops)
          if (troopMatches(troop))
            troop.strength = Math.max(
              0,
              Math.min(1e9, Math.floor(troop.strength * a.amount)),
            );
      next.troops = next.troops.filter((t) => t.strength > 0);
      log.push(
        a.kind === 'reinforce'
          ? `${a.amount >= 0 ? '+' : ''}${a.amount} бойцов в выбранных зданиях`
          : a.kind === 'multiply'
            ? `Численность ×${a.amount}`
            : `Гарнизоны: ${a.amount} бойцов`,
      );
    }
  }
  const text = log.join(' · ');
  next.decreeLog = [{ team, text, at: g.elapsed }, ...g.decreeLog].slice(0, 5);
  next.notice = `Указ: ${playerName(g, team)} — ${text}.`;
  next.automation = next.automation.filter(
    (a) => next.towers.find((t) => t.id === a.from)?.team === a.team,
  );
  return refreshAuthority(next);
}
