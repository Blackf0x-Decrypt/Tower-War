import type { Game, Shot, Tower, Troop } from './tower-game';

export type DrawSample = {
  troops: Troop[];
  towers: Tower[];
  shots: Shot[];
  age: number;
  hideMessages: boolean;
  paused: boolean;
};

let current: DrawSample = {
  troops: [],
  towers: [],
  shots: [],
  age: 0,
  hideMessages: false,
  paused: true,
};

const listeners = new Set<(sample: DrawSample) => void>();

export function publishDrawSample(game: Game, paused: boolean) {
  current = {
    troops: game.troops,
    towers: game.towers,
    shots: game.shots ?? [],
    age: game.age,
    hideMessages: !!game.hideMessages,
    paused,
  };
  for (const listener of listeners) listener(current);
}

export function subscribeDrawSample(listener: (sample: DrawSample) => void) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
