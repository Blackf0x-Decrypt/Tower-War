export type Team = 'you' | 'red' | 'purple' | 'green';

const TEAM_IDS: Team[] = ['you', 'red', 'purple', 'green'];

/** Active chaos rules applied during simulation ticks. */
export type ChaosRule = {
  kind: ChaosEffectKind;
  /** Team that cast the decree. */
  caster: Team;
  until: number;
  param: number;
};

export const CHAOS_EFFECT_KINDS = [
  'chaos_march_speed',
  'chaos_production_surge',
  'chaos_hq_shield',
  'chaos_double_wave',
  'chaos_reverse_march',
  'chaos_enemy_send_lock',
  'chaos_enemy_crawl',
  'chaos_neutral_uprising',
  'chaos_mine_birth',
  'chaos_building_shuffle',
  'chaos_hq_siege',
  'chaos_capture_rush',
  'chaos_economy_swap',
  'chaos_garrison_tremor',
  'chaos_enemy_retreat',
  'chaos_garrison_vamp',
  'chaos_monopoly_income',
  'chaos_mirror_army',
  'chaos_fog_flicker',
  'chaos_cannon_overdrive',
  'chaos_neutral_ripple',
  'chaos_enemy_fortify',
  'chaos_time_warp',
  'chaos_boomerang_legions',
  'chaos_hive_mind',
  'chaos_land_flip',
] as const;

export type ChaosEffectKind = (typeof CHAOS_EFFECT_KINDS)[number];

export function isChaosKind(kind: string): kind is ChaosEffectKind {
  return (CHAOS_EFFECT_KINDS as readonly string[]).includes(kind);
}

const ENEMY_TARGET_KINDS: ReadonlySet<ChaosEffectKind> = new Set([
  'chaos_enemy_send_lock',
  'chaos_enemy_crawl',
  'chaos_garrison_tremor',
  'chaos_enemy_retreat',
]);

export function chaosTargetsEnemies(kind: ChaosEffectKind): boolean {
  return ENEMY_TARGET_KINDS.has(kind);
}

export function enemyTeamsOf(caster: Team): Team[] {
  return TEAM_IDS.filter((t) => t !== caster);
}

export function chaosSpeedMult(
  rules: ChaosRule[] | undefined,
  age: number,
  troopTeam: Team,
): number {
  let m = 1;
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_march_speed' && r.caster === troopTeam)
      m *= r.param / 10;
    if (r.kind === 'chaos_enemy_crawl' && enemyTeamsOf(r.caster).includes(troopTeam))
      m *= r.param / 10;
    if (
      r.kind === 'chaos_enemy_retreat' &&
      enemyTeamsOf(r.caster).includes(troopTeam)
    )
      m *= Math.max(0.15, r.param / 10);
  }
  return m;
}

export function chaosEnemyRetreat(
  rules: ChaosRule[] | undefined,
  age: number,
  troopTeam: Team,
): boolean {
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (
      r.kind === 'chaos_enemy_retreat' &&
      enemyTeamsOf(r.caster).includes(troopTeam)
    )
      return true;
  }
  return false;
}

export function chaosGrowthMult(
  rules: ChaosRule[] | undefined,
  age: number,
  team: Team,
): number {
  let m = 1;
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_production_surge' && r.caster === team)
      m *= r.param / 10;
    if (r.kind === 'chaos_time_warp' && r.caster === team)
      m *= Math.max(1, r.param / 10);
  }
  return m;
}

export function chaosIncomeTeamMult(
  rules: ChaosRule[] | undefined,
  age: number,
  team: Team,
): number {
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind !== 'chaos_monopoly_income') continue;
    if (r.caster === team) return Math.max(1, r.param / 10);
    if (enemyTeamsOf(r.caster).includes(team)) return 0;
  }
  return 1;
}

export function chaosCaptureMult(
  rules: ChaosRule[] | undefined,
  age: number,
  attacker: Team,
): number {
  let m = 1;
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_capture_rush' && r.caster === attacker)
      m *= r.param / 10;
  }
  return m;
}

export function chaosReverseMarch(
  rules: ChaosRule[] | undefined,
  age: number,
  troopTeam: Team,
): boolean {
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_reverse_march' && r.caster === troopTeam) return true;
    if (
      r.kind === 'chaos_enemy_retreat' &&
      enemyTeamsOf(r.caster).includes(troopTeam)
    )
      return true;
  }
  return false;
}

export function chaosDispatchMult(
  rules: ChaosRule[] | undefined,
  age: number,
  team: Team,
): number {
  let m = 1;
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_double_wave' && r.caster === team) m = Math.max(m, 2);
    if (r.kind === 'chaos_mirror_army' && r.caster === team)
      m = Math.max(m, Math.min(4, Math.max(2, r.param)));
  }
  return m;
}

/** @deprecated use chaosDispatchMult */
export function chaosDoubleDispatch(
  rules: ChaosRule[] | undefined,
  age: number,
  team: Team,
): number {
  return chaosDispatchMult(rules, age, team);
}

export function chaosSendBlocked(
  rules: ChaosRule[] | undefined,
  age: number,
  team: Team,
): boolean {
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (
      r.kind === 'chaos_enemy_send_lock' &&
      enemyTeamsOf(r.caster).includes(team)
    )
      return true;
  }
  return false;
}

export function chaosEconomySwap(
  rules: ChaosRule[] | undefined,
  age: number,
  team: Team,
): boolean {
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_economy_swap' && r.caster === team) return true;
  }
  return false;
}

export function chaosHqSiegeAllowed(
  rules: ChaosRule[] | undefined,
  age: number,
): boolean {
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_hq_siege') return true;
  }
  return false;
}

export function chaosCannonMult(
  rules: ChaosRule[] | undefined,
  age: number,
  team: Team,
): number {
  let m = 1;
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_cannon_overdrive' && r.caster === team)
      m *= Math.max(1, r.param / 10);
  }
  return m;
}

export function chaosEnemyFortify(
  rules: ChaosRule[] | undefined,
  age: number,
  defenderTeam: Team | null,
  attackerTeam: Team,
): boolean {
  if (!defenderTeam || defenderTeam === attackerTeam) return false;
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind !== 'chaos_enemy_fortify') continue;
    if (r.caster !== attackerTeam) continue;
    if (enemyTeamsOf(r.caster).includes(defenderTeam)) return true;
  }
  return false;
}

export function chaosBoomerangLegions(
  rules: ChaosRule[] | undefined,
  age: number,
  attacker: Team,
): boolean {
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_boomerang_legions' && r.caster === attacker)
      return true;
  }
  return false;
}

export function chaosHiveMind(
  rules: ChaosRule[] | undefined,
  age: number,
  team: Team,
): boolean {
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_hive_mind' && r.caster === team) return true;
  }
  return false;
}

export function activeChaosFog(
  rules: ChaosRule[] | undefined,
  age: number,
): ChaosRule | undefined {
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_fog_flicker') return r;
  }
  return undefined;
}

export function chaosGarrisonVampPercent(
  rules: ChaosRule[] | undefined,
  age: number,
  caster: Team,
): number {
  for (const r of rules ?? []) {
    if (r.until <= age) continue;
    if (r.kind === 'chaos_garrison_vamp' && r.caster === caster)
      return Math.max(0, Math.min(0.5, r.param / 100));
  }
  return 0;
}

export function pruneChaosRules(
  rules: ChaosRule[] | undefined,
  age: number,
): ChaosRule[] | undefined {
  if (!rules?.length) return rules;
  const next = rules.filter((r) => r.until > age);
  return next.length ? next : undefined;
}
