import type { Kind, Tower } from './tower-game';

/** Central economy config (avoid magic numbers in tick). */
export type EconomyRules = {
  startGold: number;
  startResources: number;
  upgradeGoldPerLevel: number;
  upgradeWoodPerLevel: number;
  cannonGoldPerLevel: number;
  cannonWoodPerLevel: number;
  /** Phase 1 optional: mines credit wallet directly (not enabled). */
  directMineWallet: boolean;
};

export const DEFAULT_ECONOMY_RULES: EconomyRules = {
  startGold: 60,
  startResources: 40,
  upgradeGoldPerLevel: 50,
  upgradeWoodPerLevel: 30,
  cannonGoldPerLevel: 40,
  cannonWoodPerLevel: 25,
  directMineWallet: false,
};

const RESOURCE_MINE_KINDS: ReadonlySet<Kind> = new Set(['gold', 'lumber']);

export function isResourceMineKind(kind: Kind): boolean {
  return RESOURCE_MINE_KINDS.has(kind);
}

/** Garrison auto-recruit (`production()` → count) — HQ and barracks only. */
export function garrisonRecruitAllowed(t: Tower): boolean {
  if (t.ruinedAt !== undefined) return false;
  if (t.home) return true;
  return t.kind === 'barracks';
}

/** Targets eligible for chaos_mine_birth garrison adds (never gold/lumber). */
export function chaosMineBirthEligible(t: Tower): boolean {
  if (t.ruinedAt !== undefined || !t.team) return false;
  if (isResourceMineKind(t.kind)) return false;
  return t.kind === 'barracks' || t.kind === 'tower';
}

export function assertSymmetricStartWallets(
  wallets: Record<string, { gold: number; resources: number }>,
  rules: EconomyRules = DEFAULT_ECONOMY_RULES,
): boolean {
  for (const w of Object.values(wallets)) {
    if (w.gold !== rules.startGold || w.resources !== rules.startResources)
      return false;
  }
  return true;
}
