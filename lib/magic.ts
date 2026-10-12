export type DebuffStat =
  | 'speed'
  | 'growth'
  | 'income'
  | 'cannons'
  | 'dispatch'
  | 'capture';

export type Debuff = {
  title: string;
  description: string;
  effects: {
    stat: DebuffStat;
    factor: number;
    duration: number;
  }[];
};

const DEBUFF_STATS: DebuffStat[] = [
  'speed',
  'growth',
  'income',
  'cannons',
  'dispatch',
  'capture',
];

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
        DEBUFF_STATS.includes(e.stat) &&
        Number.isFinite(e.factor) &&
        e.factor >= 0.25 &&
        e.factor <= 0.95 &&
        Number.isFinite(e.duration) &&
        e.duration >= 12 &&
        e.duration <= 55,
    ) &&
    new Set(d.effects.map((e) => e.stat)).size === d.effects.length
  );
}

/** Procedural curse when roulette hits — rule tweaks, not +gold. */
export function proceduralDebuff(seed: number): Debuff {
  const options: Debuff[] = [
    {
      title: 'Клеящиеся сапоги',
      description: 'Отряды лидера выходят на 35% медленнее.',
      effects: [{ stat: 'speed', factor: 0.65, duration: 22 }],
    },
    {
      title: 'Казарма в отпуске',
      description: 'Прирост гарнизонов лидера ×0.55 на полминуты.',
      effects: [{ stat: 'growth', factor: 0.55, duration: 28 }],
    },
    {
      title: 'Налог на импульс',
      description: 'Автомаршруты шлют только половину резерва.',
      effects: [{ stat: 'dispatch', factor: 0.5, duration: 24 }],
    },
    {
      title: 'Скользкий флаг',
      description: 'Захваты лидера на 30% слабее.',
      effects: [{ stat: 'capture', factor: 0.7, duration: 20 }],
    },
    {
      title: 'Дырявые кошельки',
      description: 'Доход лидера ×0.6.',
      effects: [{ stat: 'income', factor: 0.6, duration: 26 }],
    },
    {
      title: 'Ржавые стволы',
      description: 'Пушки лидера стреляют реже.',
      effects: [{ stat: 'cannons', factor: 0.75, duration: 22 }],
    },
  ];
  return options[Math.abs(seed) % options.length];
}
