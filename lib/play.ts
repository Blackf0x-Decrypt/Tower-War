import type { Decree } from './decrees';
import { validDecree } from './decrees';
import { validDebuff, type Debuff } from './magic';
import {
  configureAutomation,
  messageOpportunity,
  readySpell,
  sendArmy,
  sendMessage,
  sendScout,
  setAutomation,
  specialize,
  startSpell,
  upgrade,
  upgradeCannon,
  type Game,
  type Specialty,
  type Team,
} from './tower-game';

export type PlayAction =
  | { type: 'army'; from: number; to: number; fraction: number }
  | { type: 'route'; from: number; to: number | null }
  | {
      type: 'route-config';
      from: number;
      mode: 'assault' | 'supply' | 'excess';
      reserve: number;
    }
  | { type: 'scout'; from: number; x: number; y: number }
  | { type: 'upgrade'; id: number }
  | { type: 'cannon'; id: number }
  | { type: 'specialize'; id: number; choice: Specialty }
  | { type: 'message'; text: string }
  | { type: 'spell-start'; text: string; roll: string }
  | {
      type: 'spell-ready';
      patch: Decree;
      epoch: number;
      debuff: Debuff | null;
      roll: string;
    }
  | { type: 'spell-cancel'; nonce?: number };

function num(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function applyPlay(g: Game, actor: Team, action: PlayAction): Game {
  switch (action.type) {
    case 'army':
      if (!num(action.from) || !num(action.to) || !num(action.fraction)) return g;
      return sendArmy(g, action.from, action.to, action.fraction, actor);
    case 'route':
      if (!num(action.from)) return g;
      return setAutomation(g, action.from, action.to, actor);
    case 'route-config':
      if (!num(action.from) || !num(action.reserve)) return g;
      return configureAutomation(
        g,
        action.from,
        action.mode,
        action.reserve,
        actor,
      );
    case 'scout':
      if (!num(action.from) || !num(action.x) || !num(action.y)) return g;
      return sendScout(g, action.from, action.x, action.y, actor);
    case 'upgrade':
      return num(action.id) ? upgrade(g, action.id, actor) : g;
    case 'cannon':
      return num(action.id) ? upgradeCannon(g, action.id, actor) : g;
    case 'specialize':
      return num(action.id)
        ? specialize(g, action.id, action.choice, actor)
        : g;
    case 'message':
      return typeof action.text === 'string' && messageOpportunity(g, actor)
        ? sendMessage(g, actor, action.text)
        : g;
    case 'spell-start':
      return typeof action.text === 'string'
        ? startSpell(g, actor, action.text, action.roll || 'disabled')
        : g;
    case 'spell-ready':
      if (g.spell?.team !== actor || !validDecree(action.patch)) return g;
      if (action.debuff !== null && !validDebuff(action.debuff)) return g;
      return readySpell(
        g,
        action.patch,
        action.epoch,
        action.debuff,
        action.roll || 'disabled',
      );
    case 'spell-cancel':
      if (!g.spell || g.spell.team !== actor || g.spell.patch) return g;
      if (typeof action.nonce === 'number' && g.spell.nonce !== action.nonce)
        return g;
      return { ...g, spell: undefined };
    default:
      return g;
  }
}
