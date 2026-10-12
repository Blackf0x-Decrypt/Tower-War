import {
  CHAOS_EFFECT_KINDS,
  type ChaosEffectKind,
  isChaosKind,
} from './chaos-rules';

export type ChaosEffectPhase = 'instant' | 'rule';

export type ChaosRegistryEntry = {
  kind: ChaosEffectKind;
  phase: ChaosEffectPhase;
  /** Skipped when game.fairMode is true (map asymmetry / instant land ops). */
  fairModeBlocked?: boolean;
};

/** Single registry for validation, UI labels, and fair-mode gating. */
export const CHAOS_REGISTRY: ChaosRegistryEntry[] = [
  { kind: 'chaos_march_speed', phase: 'rule' },
  { kind: 'chaos_production_surge', phase: 'rule' },
  { kind: 'chaos_hq_shield', phase: 'rule' },
  { kind: 'chaos_double_wave', phase: 'rule' },
  { kind: 'chaos_reverse_march', phase: 'rule' },
  { kind: 'chaos_enemy_send_lock', phase: 'rule' },
  { kind: 'chaos_enemy_crawl', phase: 'rule' },
  {
    kind: 'chaos_neutral_uprising',
    phase: 'instant',
    fairModeBlocked: true,
  },
  { kind: 'chaos_mine_birth', phase: 'instant', fairModeBlocked: true },
  { kind: 'chaos_building_shuffle', phase: 'instant', fairModeBlocked: true },
  { kind: 'chaos_hq_siege', phase: 'rule' },
  { kind: 'chaos_capture_rush', phase: 'rule' },
  { kind: 'chaos_economy_swap', phase: 'rule' },
  { kind: 'chaos_garrison_tremor', phase: 'rule' },
  { kind: 'chaos_enemy_retreat', phase: 'rule' },
  { kind: 'chaos_garrison_vamp', phase: 'rule' },
  { kind: 'chaos_monopoly_income', phase: 'rule' },
  { kind: 'chaos_mirror_army', phase: 'rule' },
  { kind: 'chaos_fog_flicker', phase: 'rule' },
  { kind: 'chaos_cannon_overdrive', phase: 'rule' },
  {
    kind: 'chaos_neutral_ripple',
    phase: 'instant',
    fairModeBlocked: true,
  },
  { kind: 'chaos_enemy_fortify', phase: 'rule' },
  { kind: 'chaos_time_warp', phase: 'rule' },
  { kind: 'chaos_boomerang_legions', phase: 'rule' },
  { kind: 'chaos_hive_mind', phase: 'rule' },
  { kind: 'chaos_land_flip', phase: 'instant', fairModeBlocked: true },
];

const REGISTRY_BY_KIND = new Map(
  CHAOS_REGISTRY.map((entry) => [entry.kind, entry]),
);

/** Public rooms: fair mode off. Set env `FAIR_CHAOS=1` on Vercel to disable map mutation + instant chaos flips. */
export function defaultFairChaosMode(): boolean {
  const v =
    process.env.FAIR_CHAOS ||
    (typeof globalThis !== 'undefined'
      ? (globalThis as { FAIR_CHAOS?: string }).FAIR_CHAOS
      : '') ||
    '';
  return v.trim() === '1';
}

export function chaosEffectPhase(kind: ChaosEffectKind): ChaosEffectPhase {
  return REGISTRY_BY_KIND.get(kind)?.phase ?? 'rule';
}

export function isFairModeBlockedInstant(kind: ChaosEffectKind): boolean {
  return REGISTRY_BY_KIND.get(kind)?.fairModeBlocked === true;
}

export function registryCoversAllKinds(): boolean {
  if (CHAOS_REGISTRY.length !== CHAOS_EFFECT_KINDS.length) return false;
  for (const kind of CHAOS_EFFECT_KINDS) {
    if (!REGISTRY_BY_KIND.has(kind)) return false;
  }
  return true;
}

export { CHAOS_EFFECT_KINDS, isChaosKind };
