import type { Game, Team } from './tower-game';
import { TEAM_IDS } from './tower-game';
import { towerCursorValue } from './room-protocol';

export function reactStamp(game: Game): string {
  const parts: string[] = [
    String(Math.floor(game.elapsed)),
    String(Math.floor(game.age)),
    game.notice,
    String(game.result),
    String(game.flash),
    String(game.authority),
    String(game.authorityEpoch),
    game.hideMessages ? '1' : '0',
  ];
  if (game.spell) {
    parts.push(
      `${game.spell.team}:${game.spell.epoch}:${game.spell.nonce ?? ''}:${game.spell.patch ? 1 : 0}:${Math.ceil((game.spell.castAt ?? game.age) - game.age)}:${game.spell.prompt}`,
    );
  }
  if (game.event) {
    parts.push(
      `${game.event.kind}:${game.event.claimed ?? ''}:${game.event.target ?? ''}:${Math.ceil(game.event.until - game.age)}:${Math.round(game.event.x)}`,
    );
  }
  for (const team of TEAM_IDS) {
    const wallet = game.wallets[team];
    parts.push(
      `${Math.floor(wallet.gold)},${Math.floor(wallet.resources)},${Math.floor(wallet.earned)}`,
    );
  }
  for (const tower of game.towers) parts.push(JSON.stringify(towerCursorValue(tower)));
  for (const route of game.routes)
    parts.push(`r${route.from}-${route.to}-${route.team}-${Math.floor(route.until)}`);
  for (const route of game.automation)
    parts.push(
      `a${route.from}-${route.to}-${route.team}-${route.mode ?? ''}-${route.reserve ?? ''}`,
    );
  const recall: string[] = [];
  for (const troop of game.troops) {
    if (!troop.cargo && !troop.haul && !troop.scoutUntil && troop.progress < 1)
      recall.push(`${troop.team}:${troop.from}`);
  }
  parts.push(recall.join(','));
  const active = (game.explosions ?? [])
    .filter((item) => game.age - item.at < 3)
    .map((item) => item.id)
    .join(',');
  parts.push(active);
  const messages = (game.messages ?? [])
    .filter((item) => item.until > game.age)
    .map((item) => `${item.team}:${item.text}`)
    .join(',');
  parts.push(messages);
  return parts.join('|');
}

export function retainTowers(prev: Game['towers'], next: Game['towers']) {
  if (prev.length !== next.length) return next;
  let dirty = false;
  const towers = next.map((tower, index) => {
    const before = prev[index];
    if (
      before &&
      before.id === tower.id &&
      JSON.stringify(towerCursorValue(before)) === JSON.stringify(towerCursorValue(tower))
    )
      return before;
    dirty = true;
    return tower;
  });
  return dirty ? towers : prev;
}

function sameList<T>(prev: T[], next: T[]) {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

export function retainBattle(prev: Game, next: Game): Game {
  const towers = retainTowers(prev.towers, next.towers);
  const routes = sameList(prev.routes, next.routes);
  const automation = sameList(prev.automation, next.automation);
  if (towers === next.towers && routes === next.routes && automation === next.automation)
    return next;
  return { ...next, towers, routes, automation };
}

export type BattleRenderInput = {
  towers: Game['towers'];
  routes: Game['routes'];
  automation: Game['automation'];
  flash: Game['flash'];
  result: Game['result'];
  spellKey: string;
  explosionKey: string;
  messageKey: string;
  hideMessages: boolean;
  growthKey: string;
  labelKey: string;
  lockKey: string;
  playerKey: string;
  eventKey: string;
  age: number;
  me: Team;
  selected: number | null;
  speech: boolean;
  routeMode: boolean;
  scoutMode: boolean;
  paused: boolean;
  help: boolean;
  recording: boolean;
};

export function battleRenderInput(
  game: Game,
  ui: Omit<
    BattleRenderInput,
    | 'towers'
    | 'routes'
    | 'automation'
    | 'flash'
    | 'result'
    | 'spellKey'
    | 'explosionKey'
    | 'messageKey'
    | 'hideMessages'
    | 'growthKey'
    | 'labelKey'
    | 'lockKey'
    | 'playerKey'
    | 'eventKey'
    | 'age'
  >,
): BattleRenderInput {
  return {
    towers: game.towers,
    routes: game.routes,
    automation: game.automation,
    flash: game.flash,
    result: game.result,
    spellKey: game.spell
      ? `${game.spell.team}:${game.spell.epoch}:${game.spell.prompt}:${Math.ceil((game.spell.castAt ?? game.age) - game.age)}`
      : '',
    explosionKey: (game.explosions ?? [])
      .filter((item) => game.age - item.at < 3)
      .map((item) => item.id)
      .join(','),
    messageKey: (game.messages ?? [])
      .filter((item) => item.until > game.age)
      .map((item) => `${item.team}:${item.text}`)
      .join(','),
    hideMessages: !!game.hideMessages,
    growthKey: JSON.stringify(game.growth),
    labelKey: JSON.stringify(game.labels ?? null),
    lockKey: JSON.stringify(game.inputLocked ?? null),
    playerKey: JSON.stringify(game.players ?? null),
    eventKey: game.event
      ? `${game.event.kind}:${game.event.claimed ?? ''}:${game.event.target ?? ''}:${Math.round(game.event.x)}:${Math.round(game.event.y)}:${Math.ceil(game.event.until - game.age)}`
      : '',
    age: Math.floor(game.age),
    ...ui,
  };
}

export function skipBattleRender(prev: BattleRenderInput, next: BattleRenderInput) {
  const keys = Object.keys(prev) as (keyof BattleRenderInput)[];
  for (const key of keys) if (prev[key] !== next[key]) return false;
  return true;
}
