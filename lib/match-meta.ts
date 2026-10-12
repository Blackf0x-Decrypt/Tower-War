import type { ChaosEffectKind } from './chaos-rules';
import { CHAOS_EFFECT_KINDS } from './chaos-rules';
import type { Decree } from './decrees';
import { isChaosKind } from './chaos-rules';
import { TEAM_IDS, type Game, type Kind, type Team } from './tower-game';

export type EpochObjectiveKind = 'hold_mines' | 'clear_neutrals' | 'survive_hq';

export type EpochObjective = {
  kind: EpochObjectiveKind;
  label: string;
  progress: number;
  target: number;
  done: boolean;
  bonusGold: number;
};

export type MapMutation = {
  id: string;
  label: string;
  towerId?: number;
};

export type MatchMutator = {
  id: string;
  label: string;
  marchMult: number;
};

export const INSTANT_CHAOS_KINDS: ReadonlySet<ChaosEffectKind> = new Set([
  'chaos_neutral_uprising',
  'chaos_mine_birth',
  'chaos_building_shuffle',
  'chaos_neutral_ripple',
  'chaos_land_flip',
]);

export function stableRoomSeed(parts: string[]): number {
  let h = 2166136261;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

export function chaosKindsInDecree(p: Decree): ChaosEffectKind[] {
  const actions = p.kind === 'batch' ? p.actions : [p];
  return actions
    .map((a) => a.kind)
    .filter((k): k is ChaosEffectKind => isChaosKind(k));
}

export function unionChaosBans(
  bans: Partial<Record<Team, ChaosEffectKind[]>> | undefined,
  humans: Team[],
): Set<ChaosEffectKind> {
  const out = new Set<ChaosEffectKind>();
  for (const team of humans) {
    for (const k of bans?.[team] ?? []) {
      if ((CHAOS_EFFECT_KINDS as readonly string[]).includes(k)) out.add(k);
    }
  }
  return out;
}

export function validChaosBanList(kinds: unknown): kinds is ChaosEffectKind[] {
  if (!Array.isArray(kinds) || kinds.length > 2) return false;
  const seen = new Set<string>();
  for (const k of kinds) {
    if (typeof k !== 'string' || !isChaosKind(k) || seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

const WEEKLY_MUTATORS: MatchMutator[] = [
  { id: 'march12', label: 'Сезон: марш ×1.2', marchMult: 1.2 },
  { id: 'march08', label: 'Сезон: марш ×0.85', marchMult: 0.85 },
  { id: 'march10', label: 'Сезон: ровный марш', marchMult: 1 },
];

export function weeklyMutator(now = Date.now()): MatchMutator {
  const forced = (
    process.env.MATCH_MUTATOR ||
    (typeof globalThis !== 'undefined'
      ? (globalThis as { MATCH_MUTATOR?: string }).MATCH_MUTATOR
      : '') ||
    ''
  ).trim();
  if (forced) {
    const hit = WEEKLY_MUTATORS.find((m) => m.id === forced);
    if (hit) return hit;
    const mult = Number(forced);
    if (Number.isFinite(mult) && mult > 0.5 && mult < 2)
      return { id: 'custom', label: `Сезон: марш ×${mult}`, marchMult: mult };
  }
  const week = Math.floor(now / (7 * 24 * 3600_000));
  return WEEKLY_MUTATORS[week % WEEKLY_MUTATORS.length]!;
}

const OBJECTIVE_DEFS: {
  kind: EpochObjectiveKind;
  label: string;
  target: number;
  bonusGold: number;
}[] = [
  { kind: 'hold_mines', label: 'Удерживать 2 шахты/леса', target: 2, bonusGold: 35 },
  { kind: 'clear_neutrals', label: 'Захватить 4 нейтральные точки', target: 4, bonusGold: 40 },
  { kind: 'survive_hq', label: 'Штаб без потери 90 с', target: 90, bonusGold: 30 },
];

export function pickEpochObjective(seed: number): EpochObjective {
  const def = OBJECTIVE_DEFS[seed % OBJECTIVE_DEFS.length]!;
  return {
    kind: def.kind,
    label: def.label,
    progress: 0,
    target: def.target,
    done: false,
    bonusGold: def.bonusGold,
  };
}

function addNeutralTower(g: Game, x: number, y: number, kind: Kind, count: number): MapMutation {
  const id = g.towers.length;
  g.towers.push({
    id,
    x,
    y,
    kind,
    count,
    team: null,
    level: 1,
    name: kind === 'gold' ? 'Золотая шахта' : kind === 'lumber' ? 'Лесопилка' : 'Мостовой форпост',
  });
  return {
    id: 'extra_neutral',
    label: 'На карте появилась лишняя нейтральная точка',
    towerId: id,
  };
}

export function applyMapMutation(g: Game, seed: number): MapMutation | null {
  const roll = seed % 3;
  if (roll === 0) {
    return addNeutralTower(g, 50, 50, 'tower', 28);
  }
  if (roll === 1) {
    const mines = g.towers.filter((t) => (t.kind === 'gold' || t.kind === 'lumber') && !t.home);
    const pick = mines[seed % Math.max(1, mines.length)];
    if (pick) {
      pick.x = Math.max(8, Math.min(92, pick.x + ((seed >> 4) % 2 ? 6 : -6)));
      pick.y = Math.max(8, Math.min(92, pick.y + ((seed >> 6) % 2 ? 5 : -5)));
      return { id: 'relocate_mine', label: 'Шахта сменила положение на карте', towerId: pick.id };
    }
  }
  const bridge = addNeutralTower(g, 50, 38, 'tower', 22);
  bridge.id = 'bridge_tile';
  bridge.label = 'Мостовой форпост соединяет центр карты';
  return bridge;
}

export {
  pickTroopRole,
  roleMult,
  troopVariantForDispatch as troopVariantFor,
  variantSpeedMult,
  type TroopRole as TroopVariant,
} from './troop-rules';

export function bootstrapMatch(
  g: Game,
  seed: number,
  banned: Set<ChaosEffectKind>,
  mutator: MatchMutator,
  fairMode = false,
): Game {
  const mutation = fairMode
    ? null
    : applyMapMutation({ ...g, towers: g.towers.map((t) => ({ ...t })) }, seed);
  const mutationNote = mutation ? ` ${mutation.label}.` : '';
  return {
    ...g,
    roomSeed: seed,
    fairMode,
    bannedChaos: [...banned],
    matchMutator: mutator,
    mapMutation: mutation ?? undefined,
    epochObjective: pickEpochObjective(seed >>> 0),
    decreeChronicle: [],
    teamVetoUsed: {},
    speed: Object.fromEntries(
      TEAM_IDS.map((t) => [t, (g.speed[t] ?? 1) * mutator.marchMult]),
    ) as Game['speed'],
    notice: `${g.notice} ${mutator.label}.${mutationNote}`,
  };
}

export function countHeldMines(g: Game, team: Team): number {
  let n = 0;
  for (const t of g.towers) {
    if (t.team === team && (t.kind === 'gold' || t.kind === 'lumber') && !t.home) n++;
  }
  return n;
}

export function countNeutrals(g: Game): number {
  return g.towers.filter((t) => !t.team && t.ruinedAt === undefined && !t.home).length;
}

export function updateEpochObjective(g: Game, dt: number, leader: Team | null): Game {
  const obj = g.epochObjective;
  if (!obj || obj.done || !leader) return g;
  let progress = obj.progress;
  if (obj.kind === 'hold_mines') {
    progress = countHeldMines(g, leader);
  } else if (obj.kind === 'clear_neutrals') {
    const totalNeutralStarts = 4;
    progress = Math.max(0, totalNeutralStarts - countNeutrals(g));
  } else if (obj.kind === 'survive_hq') {
    const hq = g.towers.find((t) => t.home === leader && t.ruinedAt === undefined);
    if (hq && hq.team === leader) progress = Math.min(obj.target, progress + dt);
    else progress = 0;
  }
  const done = progress >= obj.target;
  if (!done || obj.done) {
    return { ...g, epochObjective: { ...obj, progress, done } };
  }
  const w = g.wallets[leader];
  return {
    ...g,
    epochObjective: { ...obj, progress, done: true },
    wallets: {
      ...g.wallets,
      [leader]: {
        ...w,
        gold: w.gold + obj.bonusGold,
        earned: w.earned + obj.bonusGold * 0.5,
      },
    },
    notice: `Задача эпохи выполнена · +${obj.bonusGold} золота лидеру`,
  };
}

export function decreeHasInstantReveal(p: Decree): boolean {
  return chaosKindsInDecree(p).some((k) => INSTANT_CHAOS_KINDS.has(k));
}
