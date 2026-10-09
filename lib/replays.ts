import {
  initialGame,
  tick,
  dispatch,
  upgrade,
  refreshAuthority,
  economicLeader,
  applyDecree,
  sendMessage,
  announcePrompt,
  type Game,
  type Team,
} from './tower-game';
import type { Decree } from './decrees';
export type ReplayEvent = { at: number } & (
  | { kind: 'order'; from: number; to: number; fraction: number }
  | { kind: 'upgrade'; id: number }
  | { kind: 'lead'; team: Team | null }
  | { kind: 'message'; team: Team; text: string }
  | { kind: 'prompt'; team: Team; text: string; patch?: Decree }
  | { kind: 'apply'; team: Team; patch: Decree }
  | {
      kind: 'wave';
      region: 'south' | 'north' | 'all';
      team?: Team;
      targets?: Team[];
      ids?: number[];
    }
  | { kind: 'hq-damage'; amount: number }
  | { kind: 'army-transfer'; from: Team; to: Team }
  | { kind: 'explode'; teams: Team[] }
  | { kind: 'buildings-transfer'; from: Team; to: Team }
  | { kind: 'minesweeper'; boards: { team: Team; finish: number; failed: boolean }[] }
  | { kind: 'input-lock'; except: Team }
  | { kind: 'rename'; team: Team; name: string }
  | { kind: 'label'; except: Team; text: string }
  | { kind: 'burn'; team: Team; duration: number }
  | { kind: 'ownership'; id: number; team: Team; count: number }
  | { kind: 'power'; team: Team; factor: number }
  | {
      kind: 'roulette';
      stage: 'spinning' | 'submissions' | 'chosen';
      entries: { team: Team; text: string }[];
      selected?: number;
      until: number;
    }
  | { kind: 'final-era' }
);
export type ReplayState = {
  game: Game;
  eventIndex: number;
  leader: Team | null;
};
export type Recording = {
  version: 1;
  id: string;
  title: string;
  duration: number;
  description: string;
  players?: Partial<Record<Team, string>>;
  events: ReplayEvent[];
  typing: {
    start: number;
    end: number;
    team: Team;
    kind: 'message' | 'prompt' | 'debuff';
    text: string;
  }[];
  chapters: { at: number; title: string; x: number; y: number; zoom: number }[];
  checkpoints: ReplayState[];
};
export function initialReplayState(
  recording?: Pick<Recording, 'players'>,
): ReplayState {
  const game = initialGame();
  game.players = recording?.players;
  if (recording?.players)
    game.towers = game.towers.map((t) =>
      t.home
        ? { ...t, name: `Штаб · ${recording.players?.[t.home] ?? t.home}` }
        : t,
    );
  game.botAt = 1e9;
  game.botDecreeAt = 1e9;
  game.eventAt = 1e9;
  game.supplyAt = 1e9;
  return { game, eventIndex: 0, leader: null };
}
function pinLeader(g: Game, team: Team | null) {
  if (team && economicLeader(g) !== team)
    g = {
      ...g,
      wallets: {
        ...g.wallets,
        [team]: {
          ...g.wallets[team],
          earned:
            Math.max(...Object.values(g.wallets).map((w) => w.earned)) + 25,
        },
      },
    };
  return refreshAuthority(g);
}
function event(g: Game, e: ReplayEvent): Game {
  if (e.kind === 'hq-damage') return { ...g, towers: g.towers.map(t => t.home ? {...t, count: Math.max(0,t.count-e.amount)} : t) };
  if (e.kind === 'minesweeper') return {...g, minesweeper: {start:g.age, until:g.age+34, boards:e.boards}};
  if (e.kind === 'army-transfer') return {...g,
    towers:g.towers.map(t=>t.team===e.from ? {...t,count:0} : t),
    troops:g.troops.map(t=>t.team===e.from ? {...t,team:e.to} : t),
    growth:{...g.growth,[e.from]:0}};
  if (e.kind === 'buildings-transfer') return {...g,
    towers:g.towers.map(t=>t.team===e.from ? {...t,team:e.to} : t),
    troops:g.troops.map(t=>t.team===e.from ? {...t,team:e.to} : t),
    routes:g.routes.filter(t=>t.team!==e.from), automation:g.automation.filter(t=>t.team!==e.from)};
  if (e.kind === 'explode') return {...g,
    explosions:[...(g.explosions??[]),...g.towers.filter(t=>t.team && e.teams.includes(t.team)).map(t=>({id:t.id,at:g.age}))],
    towers:g.towers.map(t=>t.team && e.teams.includes(t.team) ? {...t,team:null,count:0,ruinedAt:g.age,stockGold:0,stockWood:0} : t),
    troops:g.troops.filter(t=>!e.teams.includes(t.team)),
    routes:g.routes.filter(t=>!e.teams.includes(t.team)), automation:g.automation.filter(t=>!e.teams.includes(t.team))};

  if (e.kind === 'input-lock')
    return {
      ...g,
      inputLocked: Object.fromEntries(
        (['you', 'red', 'purple', 'green'] as Team[])
          .filter((t) => t !== e.except)
          .map((t) => [t, true]),
      ),
    };
  if (e.kind === 'rename')
    return {
      ...g,
      players: { ...g.players, [e.team]: e.name },
      towers: g.towers.map((t) =>
        t.home && t.team === e.team ? { ...t, name: `Штаб · ${e.name}` } : t,
      ),
    };
  if (e.kind === 'label')
    return {
      ...g,
      labels: Object.fromEntries(
        (['you', 'red', 'purple', 'green'] as Team[])
          .filter((t) => t !== e.except)
          .map((t) => [t, e.text]),
      ),
    };
  if (e.kind === 'burn')
    return { ...g, burningRule: { team: e.team, until: g.age + e.duration } };
  if (e.kind === 'ownership')
    return {
      ...g,
      towers: g.towers.map((t) =>
        t.id === e.id ? { ...t, team: e.team, count: e.count } : t,
      ),
    };
  if (e.kind === 'power')
    return {
      ...g,
      towers: g.towers.map((t) =>
        t.team === e.team
          ? { ...t, count: Math.min(1e9, t.count * e.factor) }
          : t,
      ),
      troops: g.troops
        .filter((p) => p.team !== e.team || e.factor !== 0)
        .map((p) =>
          p.team === e.team
            ? { ...p, strength: Math.min(1e9, p.strength * e.factor) }
            : p,
        ),
      growth: e.factor === 0 ? { ...g.growth, [e.team]: 0 } : g.growth,
    };
  if (e.kind === 'roulette')
    return {
      ...g,
      replayRoulette: {
        stage: e.stage,
        entries: e.entries,
        selected: e.selected,
        until: e.until,
      },
    };
  if (e.kind === 'order')
    return g.inputLocked?.[g.towers[e.from].team ?? 'you']
      ? g
      : dispatch(g, e.from, e.to, e.fraction);
  if (e.kind === 'upgrade') {
    const t = g.towers[e.id];
    return t.team ? upgrade(g, e.id, t.team) : g;
  }
  if (e.kind === 'message') return sendMessage(g, e.team, e.text);
  if (e.kind === 'prompt') {
    g = announcePrompt(g, e.team, e.text);
    if (!e.patch)
      return {
        ...g,
        notice: e.text.includes('как тут')
          ? 'Вопрос не изменил правила. Следующая попытка — через минуту.'
          : 'Приказ принят…',
      };
    g = pinLeader(g, e.team);
    return applyDecree(g, e.team, e.patch, g.authorityEpoch);
  }
  if (e.kind === 'apply') {
    g = pinLeader(g, e.team);
    return applyDecree(g, e.team, e.patch, g.authorityEpoch);
  }
  if (e.kind === 'final-era') return { ...g, allowHeadquartersCapture: true };
  if (e.kind === 'wave') {
    const actor = e.team ?? 'purple';
    if (g.inputLocked?.[actor]) return g;
    const enemies = g.towers.filter(
      (t) =>
        t.team !== actor &&
        (!e.ids || e.ids.includes(t.id)) &&
        t.ruinedAt === undefined &&
        (!e.targets || (!!t.team && e.targets.includes(t.team))) &&
        (e.region === 'all' ||
          (e.region === 'south' ? t.y > 50 : t.y <= 50 && !t.home)),
    );
    for (const target of enemies) {
      const source = g.towers
        .filter((t) => t.team === actor && t.count > (e.team ? 8 : 50))
        .sort((a, b) => b.count - a.count)[0];
      if (source)
        g = dispatch(
          g,
          source.id,
          target.id,
          Math.min(0.85, 1 / Math.max(1, enemies.length)),
        );
    }
    return g;
  }
  return g;
}
export function advanceReplay(
  previous: ReplayState,
  seconds: number,
  recording: Pick<Recording, 'events' | 'duration'>,
): ReplayState {
  let state = previous;
  const steps = Math.round(
    Math.min(seconds, recording.duration - previous.game.age) / 0.05,
  );
  for (let n = 0; n < steps; n++) {
    const age = Math.round((state.game.age + 0.05) * 20) / 20;
    let g = tick(state.game, 0.05);
    g = { ...g, age, elapsed: age };
    let leader = state.leader,
      index = state.eventIndex;
    g = pinLeader(g, leader);
    while (
      index < recording.events.length &&
      recording.events[index].at <= age
    ) {
      const e = recording.events[index++];
      if (e.kind === 'lead') {
        leader = e.team;
        g = pinLeader(g, leader);
      } else g = event(g, e);
    }
    if (!leader && age >= 240) g = { ...g, authority: null };
    state = { game: g, eventIndex: index, leader };
  }
  return state;
}
export function seekReplay(recording: Recording, time: number): ReplayState {
  const at = Math.max(
    0,
    Math.min(recording.duration, Math.round(time * 20) / 20),
  );
  const saved =
    [...recording.checkpoints].reverse().find((c) => c.game.age <= at) ??
    initialReplayState(recording);
  return advanceReplay(structuredClone(saved), at - saved.game.age, recording);
}
