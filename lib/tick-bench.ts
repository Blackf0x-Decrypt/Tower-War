// Tiny mid-game tick bench. Run: node --experimental-strip-types --import ./lib/test-register.mjs lib/tick-bench.ts
import { dispatch, initialGame, tick, type Game, type Team } from './tower-game';

function midGame(): Game {
  let g = initialGame();
  const teams: Team[] = ['you', 'red', 'purple', 'green'];
  g = {
    ...g,
    age: 90,
    elapsed: 90,
    botAt: 90,
    eventAt: 90,
    towers: g.towers.map((t, i) => ({
      ...t,
      team: t.home ?? teams[i % 4],
      count: t.home ? 80 : 160,
      level: t.home ? 3 : 2,
      gunLevel: t.kind === 'gold' || t.kind === 'lumber' ? undefined : 3,
      stockGold: t.kind === 'gold' ? 40 : 8,
      stockWood: t.kind === 'lumber' ? 40 : 6,
      caravanAt: 0,
    })),
    wallets: {
      you: { gold: 400, resources: 300, earned: 120 },
      red: { gold: 380, resources: 280, earned: 110 },
      purple: { gold: 360, resources: 260, earned: 100 },
      green: { gold: 340, resources: 240, earned: 90 },
    },
  };
  const sources = g.towers.filter((t) => t.team && t.kind !== 'gold' && t.kind !== 'lumber');
  for (let wave = 0; wave < 3; wave++) {
    for (const source of sources) {
      const enemy = g.towers.find(
        (t) => t.team && t.team !== source.team && t.id !== source.id,
      );
      if (!enemy || source.count < 12) continue;
      g = dispatch(g, source.id, enemy.id, 0.45);
    }
  }
  return g;
}

function fingerprint(g: Game): string {
  let h = 2166136261;
  const add = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  add(String(g.nextId));
  add(g.notice);
  add(String(g.result));
  add(String(g.authority));
  add(String(g.orders));
  add(String(g.captures));
  for (const t of g.towers) {
    add(
      [
        t.id,
        t.team,
        t.count,
        t.level,
        t.gunLevel ?? 0,
        t.stockGold ?? 0,
        t.stockWood ?? 0,
        t.aim ?? 0,
        t.shotAt ?? 0,
        t.home ?? '',
        t.idleSince ?? '',
        t.specialty ?? '',
      ].join(','),
    );
  }
  for (const p of g.troops) {
    add(
      [
        p.id,
        p.team,
        p.x,
        p.y,
        p.strength,
        p.to,
        p.progress,
        p.delay,
        p.cargo ? 1 : 0,
        p.haul?.gold ?? '',
        p.haul?.resources ?? '',
        p.stolenAt ?? '',
      ].join(','),
    );
  }
  for (const s of g.shots ?? []) add([s.id, s.target, s.hit ? 1 : 0, s.x, s.y, s.damage ?? 0].join(','));
  for (const team of ['you', 'red', 'purple', 'green'] as Team[]) {
    const w = g.wallets[team];
    add([team, w.gold, w.resources, w.earned].join(','));
  }
  return (h >>> 0).toString(16);
}

const N = 200;
const game = midGame();
const started = performance.now();
let g = game;
for (let i = 0; i < N; i++) g = tick(g);
const ms = performance.now() - started;
console.log(
  `ticks=${N} troops0=${game.troops.length} towers=${game.towers.length} ms=${ms.toFixed(1)} ms/tick=${(ms / N).toFixed(3)} troopsN=${g.troops.length} shots=${g.shots?.length ?? 0} hash=${fingerprint(g)}`,
);
