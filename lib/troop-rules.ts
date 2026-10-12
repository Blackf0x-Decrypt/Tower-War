import { stableRoomSeed } from './match-meta';
import type { Kind, Team, Tower } from './tower-game';

export type TroopRole = 'line' | 'heavy' | 'scout' | 'skirm';

export type TroopStat = 'speed' | 'strength' | 'capture' | 'cannonExposure';

export type TroopRules = {
  roles: Record<
    TroopRole,
    {
      speedMult: number;
      strengthMult: number;
      cannonExposureMult: number;
      captureMult: number;
      icon: string;
    }
  >;
  dispatchVisualCap: number;
  eliteStrengthMult: number;
};

export const DEFAULT_TROOP_RULES: TroopRules = {
  roles: {
    line: {
      speedMult: 1,
      strengthMult: 1,
      cannonExposureMult: 1,
      captureMult: 1,
      icon: 'line',
    },
    heavy: {
      speedMult: 0.88,
      strengthMult: 1.35,
      cannonExposureMult: 0.85,
      captureMult: 1.15,
      icon: 'heavy',
    },
    scout: {
      speedMult: 1.12,
      strengthMult: 0.65,
      cannonExposureMult: 1.2,
      captureMult: 0.9,
      icon: 'scout',
    },
    skirm: {
      speedMult: 1.05,
      strengthMult: 0.9,
      cannonExposureMult: 1,
      captureMult: 1,
      icon: 'skirm',
    },
  },
  dispatchVisualCap: 24,
  eliteStrengthMult: 2,
};

export type DispatchCtx = {
  team: Team;
  from: number;
  to: number;
  index: number;
  sourceKind?: Kind;
  target?: Pick<Tower, 'kind' | 'team' | 'home' | 'level'>;
  cargo?: boolean;
};

export function roleMult(
  role: TroopRole | undefined,
  stat: TroopStat,
  rules: TroopRules = DEFAULT_TROOP_RULES,
): number {
  const key = role ?? 'line';
  const row = rules.roles[key] ?? rules.roles.line;
  switch (stat) {
    case 'speed':
      return row.speedMult;
    case 'strength':
      return row.strengthMult;
    case 'capture':
      return row.captureMult;
    case 'cannonExposure':
      return row.cannonExposureMult;
  }
}

/** Deterministic role from route context (humans and bots use the same path). */
export function pickTroopRole(ctx: DispatchCtx): TroopRole {
  if (ctx.cargo) return 'line';
  const target = ctx.target;
  const h = stableRoomSeed([
    ctx.team,
    String(ctx.from),
    String(ctx.to),
    String(ctx.index),
    ctx.sourceKind ?? '',
    target?.kind ?? '',
    target?.team ?? 'neutral',
  ]);
  const roll = h % 100;
  if (ctx.sourceKind === 'barracks') {
    if (roll < 40) return 'heavy';
    if (roll < 70) return 'line';
    return 'skirm';
  }
  if (target && !target.team && (target.kind === 'gold' || target.kind === 'lumber')) {
    return roll < 55 ? 'scout' : 'skirm';
  }
  if (target?.team && target.team !== ctx.team && (target.home || target.level >= 3)) {
    return roll < 62 ? 'heavy' : 'line';
  }
  if (target?.team === ctx.team) return 'line';
  if (roll < 22) return 'scout';
  if (roll < 48) return 'heavy';
  if (roll < 74) return 'skirm';
  return 'line';
}

/** @deprecated use roleMult(role, 'speed') */
export function variantSpeedMult(v: TroopRole | undefined): number {
  return roleMult(v, 'speed');
}

export function troopVariantForDispatch(
  team: Team,
  from: number,
  to: number,
  index: number,
  source?: Tower,
  target?: Tower,
  cargo?: boolean,
): TroopRole {
  return pickTroopRole({
    team,
    from,
    to,
    index,
    sourceKind: source?.kind,
    target: target
      ? { kind: target.kind, team: target.team, home: target.home, level: target.level }
      : undefined,
    cargo,
  });
}
