export type Debuff = {
  title: string;
  description: string;
  effects: {
    stat: 'speed' | 'growth' | 'income' | 'cannons';
    factor: number;
    duration: number;
  }[];
};
export function validDebuff(value: unknown): value is Debuff {
  if (!value || typeof value !== 'object') return false;
  const d = value as Debuff;
  return (
    typeof d.title === 'string' &&
    d.title.length > 0 &&
    d.title.length <= 60 &&
    typeof d.description === 'string' &&
    d.description.length <= 220 &&
    Array.isArray(d.effects) &&
    d.effects.length >= 1 &&
    d.effects.length <= 2 &&
    d.effects.every(
      (e) =>
        !!e &&
        ['speed', 'growth', 'income', 'cannons'].includes(e.stat) &&
        Number.isFinite(e.factor) &&
        e.factor >= 0.35 &&
        e.factor <= 0.85 &&
        Number.isFinite(e.duration) &&
        e.duration >= 15 &&
        e.duration <= 60,
    ) &&
    new Set(d.effects.map((e) => e.stat)).size === d.effects.length
  );
}
