'use client';
import { memo, type CSSProperties, type RefObject } from 'react';
import {
  ChevronRight,
  Coins,
  Crown,
  Package,
  Radio,
  Repeat2,
  Sparkles,
  Trees,
  X,
} from 'lucide-react';
import {
  battleRenderInput,
  skipBattleRender,
  type BattleRenderInput,
} from '@/lib/live-view';
import {
  KIND_LABEL,
  SPECIALTIES,
  TEAMS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  cannon,
  cannonHeight,
  hasCannon,
  income,
  playerName,
  production,
  type Game,
  type Team,
  type Tower,
} from '@/lib/tower-game';

export const battleRenderCount = { n: 0 };

export function resetBattleRenderCount() {
  battleRenderCount.n = 0;
}

export type TowerHandlers = {
  tower: (tower: Tower) => void;
  clear: () => void;
  scout: (from: number, x: number, y: number) => void;
};

type Props = {
  game: Game;
  me: Team;
  selected: number | null;
  speech: boolean;
  routeMode: boolean;
  scoutMode: boolean;
  paused: boolean;
  help: boolean;
  recording: boolean;
  handlers: RefObject<TowerHandlers>;
};

function inputOf(props: Props): BattleRenderInput {
  return battleRenderInput(props.game, {
    me: props.me,
    selected: props.selected,
    speech: props.speech,
    routeMode: props.routeMode,
    scoutMode: props.scoutMode,
    paused: props.paused,
    help: props.help,
    recording: props.recording,
  });
}

export const BattlefieldLayer = memo(function BattlefieldLayer({
  game,
  me,
  selected,
  speech,
  routeMode,
  scoutMode,
  handlers,
}: Props) {
  battleRenderCount.n += 1;
  const source = game.towers.find((tower) => tower.id === selected && tower.team === me);
  return (
    <>
      <div className="battle-units">
        <svg className="ground-routes" aria-hidden="true">
          {game.automation.map((route) => {
            const a = game.towers[route.from];
            const b = game.towers[route.to];
            if (!a || !b) return null;
            return (
              <line
                key={`${route.team}-${route.from}-${route.to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={TEAMS[route.team].color}
                strokeWidth="1.15"
                strokeLinecap="round"
                opacity="0.72"
              />
            );
          })}
        </svg>
        <svg className="routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="3"
              markerHeight="3"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#fff" />
            </marker>
          </defs>
          {[
            ...game.routes,
            ...game.automation
              .filter((a) => !game.routes.some((r) => r.from === a.from && r.to === a.to))
              .map((a) => ({ ...a, until: Infinity })),
          ].map((r) => {
            const a = game.towers[r.from],
              b = game.towers[r.to];
            return (
              <g key={`${r.from}-${r.to}`}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={TEAMS[r.team].color}
                  strokeWidth=".5"
                  opacity=".25"
                />
                <line
                  className="route-dashes"
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={TEAMS[r.team].color}
                  strokeWidth=".22"
                  strokeDasharray=".7 .8"
                  markerEnd="url(#arrow)"
                />
              </g>
            );
          })}
          {source && hasCannon(source) && (
            <ellipse
              cx={source.x}
              cy={source.y}
              rx={(cannon(source).range / WORLD_WIDTH) * 100}
              ry={(cannon(source).range / WORLD_HEIGHT) * 100}
              fill="#ffffff08"
              stroke="#fff5be99"
              strokeWidth=".1"
              strokeDasharray=".4 .4"
            />
          )}
        </svg>
        {source && (
          <div className="target-hint">
            Выбрано: {source.name}
            <ChevronRight size={16} />{' '}
            {scoutMode ? 'Укажите точку разведки' : routeMode ? 'Цель маршрута' : 'Цель атаки'}{' '}
            <button onClick={() => handlers.current.clear()} aria-label="Отменить выбор">
              <X size={14} />
            </button>
          </div>
        )}
        {game.towers.map((t) => (
          <button
            key={t.id}
            onClick={() => handlers.current.tower(t)}
            className={`tower team-${t.team ?? 'neutral'} ${source?.id === t.id ? 'selected' : ''} ${t.kind} ${t.ruinedAt !== undefined ? 'ruined' : ''} ${t.ruinedAt !== undefined && game.age - t.ruinedAt < 8 ? 'burning-site' : ''} ${t.home ? 'headquarters' : ''} ${game.flash === t.id ? 'captured' : ''}`}
            style={
              {
                left: `${t.x}%`,
                top: `${t.y}%`,
                zIndex: Math.round(t.y) + 20,
                '--color': t.team ? TEAMS[t.team].color : '#a8a9a1',
                '--gun-height': `${cannonHeight(t)}px`,
              } as CSSProperties
            }
            aria-label={`${t.name}, ${t.team ? playerName(game, t.team) : 'нейтральная'}, ${Math.floor(t.count)} бойцов`}
          >
            {game.explosions?.some((e) => e.id === t.id && game.age - e.at < 3) && (
              <span className="base-explosion" key={Math.floor(game.age)}>
                💥
              </span>
            )}
            {t.ruinedAt !== undefined && (
              <span
                className={`burn-remains ${game.age - t.ruinedAt < 8 ? 'burning' : ''}`}
                aria-label="Сгоревшая лесопилка"
              >
                {game.age - t.ruinedAt < 8 ? '🔥' : '🪨'}
              </span>
            )}
            <span className="selection-ring" />
            {!t.home && <span className="building-id">№{t.id + 1}</span>}
            <img
              className={`tower-art level-${t.level}`}
              src={
                t.kind === 'gold'
                  ? '/assets/gold-mine.png'
                  : t.kind === 'lumber'
                    ? '/assets/sawmill.png'
                    : '/assets/tower.png'
              }
              alt=""
              draggable={false}
            />
            {game.spell && t.home && t.team === game.spell.team && (
              <span className="cast-beacon">
                <Sparkles size={24} />
                <b>
                  {game.spell.castAt
                    ? `${Math.max(0, Math.ceil(game.spell.castAt - game.age))} с`
                    : '✦'}
                </b>
              </span>
            )}
            {t.specialty && (
              <span className="specialty-badge" title={SPECIALTIES[t.specialty]}>
                {t.specialty === 'economy'
                  ? '◆'
                  : t.specialty === 'fortress'
                    ? '⛨'
                    : t.specialty === 'elite'
                      ? '★'
                      : '♟'}
              </span>
            )}
            <span className="tower-number">
              {Math.floor(t.count).toLocaleString('ru-RU')}
              <small>
                {Array.from({ length: t.level }, (_, i) => (
                  <i key={i} />
                ))}
              </small>
            </span>
            {game.automation.some((a) => a.from === t.id) && (
              <span className="auto-badge">
                <Repeat2 size={12} />
              </span>
            )}
            {t.home && t.team && (
              <span className="hq-nickname" style={{ color: TEAMS[t.team].color }}>
                {playerName(game, t.team)}
                {game.labels?.[t.team] && (
                  <small className="player-status">{game.labels[t.team]}</small>
                )}
                {game.inputLocked?.[t.team] && (
                  <small className="input-lock-status" title="Мышь и клавиатура отключены">
                    🖱 ⌨ ⊘
                  </small>
                )}
              </span>
            )}
            {t.home &&
              t.team &&
              !game.hideMessages &&
              speech &&
              (game.messages ?? [])
                .filter((m) => m.team === t.team && m.until > game.age)
                .map((m) => (
                  <span className="hq-message" key={`${m.team}-${m.until}`}>
                    {m.text}
                  </span>
                ))}
            {t.home && (
              <span className="hq-label">
                <Crown size={12} /> ШТАБ{' '}
                <small>+{(production(t) * game.growth[t.team!]).toFixed(1)}/с</small>
              </span>
            )}
            {t.kind !== 'tower' && (
              <span className="special-label">
                {t.kind === 'gold' ? (
                  <Coins size={15} />
                ) : t.kind === 'lumber' ? (
                  <Trees size={15} />
                ) : t.kind === 'relay' ? (
                  <Radio size={15} />
                ) : (
                  <Package size={15} />
                )}{' '}
                {KIND_LABEL[t.kind]}
                {t.kind === 'gold'
                  ? ` +${income(t).gold.toFixed(1)}/с`
                  : t.kind === 'lumber'
                    ? ` +${income(t).resources.toFixed(1)}/с`
                    : ''}
              </span>
            )}
            {source?.id === t.id && !t.home && <span className="source-label">ВАША БАШНЯ</span>}
          </button>
        ))}
      </div>
      {game.event && !game.event.claimed && (
        <button
          className="event-beacon"
          style={{ left: `${game.event.x}%`, top: `${game.event.y}%` }}
          title="Отправьте отряд или разведчика к событию"
          onClick={() => {
            if (!source || !game.event) return;
            if (game.event.kind === 'caravan')
              handlers.current.scout(source.id, game.event.x, game.event.y);
            else if (game.event.target !== undefined)
              handlers.current.tower(game.towers[game.event.target]);
          }}
        >
          {game.event.kind === 'deposit'
            ? '💎 ×3'
            : game.event.kind === 'fortress'
              ? '⚑ +50'
              : '💰 150'}
          <small>{Math.ceil(game.event.until - game.age)} с</small>
        </button>
      )}
    </>
  );
}, (prev, next) => skipBattleRender(inputOf(prev), inputOf(next)));
