'use client';

import { Flag } from 'lucide-react';
import { playerName, type Game, type Team } from '@/lib/tower-game';

type MatchHudProps = {
  game: Game;
  me: Team;
  yoursCount: number;
  focusPoint: (x: number, y: number) => void;
};

export function MatchHud({ game, me, yoursCount, focusPoint }: MatchHudProps) {
  const depositTarget =
    game.event?.kind === 'deposit' && game.event.target != null
      ? game.towers.find((t) => t.id === game.event!.target)
      : undefined;

  return (
    <div className="hud-notifications" aria-live="polite">
      <div className="battle-notice">
        <span className="notice-dot" />
        <p>{game.notice}</p>
        <span className="captured-count">
          <Flag size={15} />
          {yoursCount} / {game.towers.length}
        </span>
      </div>
      {game.event && !game.event.claimed && (
        <button
          className="event-notice"
          type="button"
          onClick={() => focusPoint(game.event!.x, game.event!.y)}
        >
          {game.event.kind === 'deposit' ? (
            <>
              💎 Жила ×3
              {depositTarget?.team
                ? ` · ${playerName(game, depositTarget.team)}`
                : ''}
            </>
          ) : game.event.kind === 'fortress' ? (
            '⚑ Форт +50'
          ) : (
            '💰 Караван'
          )}{' '}
          · {Math.ceil(game.event.until - game.age)} с ↗
        </button>
      )}
      {game.spell && (
        <output className="spell-toast">
          <div
            className={`roulette-disc ${game.spell.patch || game.spell.roll === 'disabled' ? 'settled' : ''}`}
          >
            {game.spell.roll === 'debuff' ? '☠' : game.spell.patch ? '✦' : '?'}
          </div>
          <div>
            <b>
              {playerName(game, game.spell.team)}:{' '}
              {game.spell.patch
                ? (game.spell.debuff?.title ?? 'Без штрафа')
                : game.spell.roll === 'disabled'
                  ? 'Подготовка приказа'
                  : 'Рулетка · DeepSeek'}
            </b>
            <small className="casting-prompt">{game.spell.prompt}</small>
            <small>
              {game.spell.patch
                ? `${Math.max(0, Math.ceil((game.spell.castAt ?? game.age) - game.age))} с · удержите лидерство`
                : 'Бой продолжается…'}
            </small>
            {game.spell.debuff && <p>{game.spell.debuff.description}</p>}
          </div>
        </output>
      )}
      {(game.curses ?? [])
        .filter((c) => c.team === me)
        .map((c, i) => (
          <div
            className="curse-toast"
            key={`${c.at}-${i}`}
            title={c.debuff.description}
          >
            ☠ {c.debuff.title} ·{' '}
            {Math.ceil(
              Math.max(
                ...c.debuff.effects.map((e) => c.at + e.duration - game.age),
              ),
            )}{' '}
            с
          </div>
        ))}
    </div>
  );
}
