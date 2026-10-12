'use client';

import {
  Check,
  Crown,
  Flag,
  Play,
  Settings,
  Sparkles,
} from 'lucide-react';
import { CHAOS_EFFECT_KINDS, type ChaosEffectKind } from '@/lib/chaos-rules';
import { TEAM_IDS, TEAMS, type Team } from '@/lib/tower-game';
import type { RoomLobbyView } from '@/hooks/useRoomTransport';

type LobbyPanelProps = {
  lobby: RoomLobbyView | null;
  clock: number;
  callName: string;
  setCallName: (v: string) => void;
  picked: Team;
  setPicked: (t: Team) => void;
  seat: { id: string; team: Team } | null;
  roomError: string;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  settingsPanel: React.ReactNode;
  banDraft: ChaosEffectKind[];
  setBanDraft: React.Dispatch<React.SetStateAction<ChaosEffectKind[]>>;
  onSit: (team: Team) => void;
  onSwitchColor: (team: Team) => void;
  onToggleReady: () => void;
  onReleaseSeat: () => void;
  onBeginSolo: () => void;
  onChaosBan: (kinds: ChaosEffectKind[]) => void;
};

export function LobbyPanel({
  lobby,
  clock,
  callName,
  setCallName,
  picked,
  setPicked,
  seat,
  roomError,
  showSettings,
  setShowSettings,
  settingsPanel,
  banDraft,
  setBanDraft,
  onSit,
  onSwitchColor,
  onToggleReady,
  onReleaseSeat,
  onBeginSolo,
  onChaosBan,
}: LobbyPanelProps) {
  return (
    <main className="start-screen">
      {lobby?.startAt != null && (
        <div className="start-countdown">
          {Math.max(
            1,
            Math.ceil((lobby.startAt - (clock || Date.now())) / 1000),
          )}
        </div>
      )}
      <div className="start-settings">
        <button
          className="square-button"
          aria-label="Настройки"
          type="button"
          onClick={() => setShowSettings(!showSettings)}
        >
          <Settings size={20} />
        </button>
        {showSettings && settingsPanel}
      </div>
      <div className="start-cloud">
        <span>СТРАТЕГИЯ, В КОТОРОЙ ВЛАСТЬ МЕНЯЕТ ПРАВИЛА</span>
      </div>
      <div className="start-title">
        <small>СОЛНЕЧНАЯ ДОЛИНА</small>
        <h1>
          FORGE<span>OF WILL</span>
        </h1>
        <p>
          Развивай экономику. Стань лидером.
          <br />
          Напиши свой закон победы.
        </p>
      </div>
      <div className="start-army" aria-hidden="true">
        <img className="menu-tower red" src="/assets/tower.png" alt="" />
        <img className="menu-tower blue" src="/assets/tower.png" alt="" />
        <img className="menu-soldier" src="/assets/soldier.png" alt="" />
      </div>
      <section className="start-panel">
        <div className="start-mode">
          <Crown />
          <span>
            БИТВА ЗА ПРАВО ЖЕЛАНИЯ
            <small>Один матч на всех · выберите свой цвет</small>
          </span>
        </div>
        <label className="seat-name">
          Имя
          <input
            value={callName}
            maxLength={16}
            onChange={(e) => setCallName(e.target.value)}
          />
        </label>
        <div className="color-pick">
          {TEAM_IDS.map((id) => {
            const taken = lobby?.seats.find((s) => s.team === id);
            const mine = seat?.team === id;
            return (
              <button
                key={id}
                type="button"
                className={picked === id || mine ? 'picked' : ''}
                style={{ background: TEAMS[id].color }}
                disabled={!!taken && !mine}
                onClick={() => {
                  setPicked(id);
                  if (mine || taken) return;
                  if (!seat) {
                    onSit(id);
                    return;
                  }
                  onSwitchColor(id);
                }}
              >
                {TEAMS[id].name}
                <small>
                  {mine
                    ? lobby?.you?.ready
                      ? 'готов'
                      : 'вы'
                    : taken
                      ? taken.away
                        ? `${taken.name} · нет связи`
                        : taken.ready
                          ? `${taken.name} · готов`
                          : taken.name
                      : 'свободен'}
                </small>
              </button>
            );
          })}
        </div>
        {roomError && <p className="room-error">{roomError}</p>}
        {seat ? (
          <>
            <button
              type="button"
              className={`play-button ${lobby?.you?.ready ? 'is-ready' : ''}`}
              onClick={() => onToggleReady()}
            >
              <Check /> {lobby?.you?.ready ? 'Отменить готовность' : 'Готов'}
            </button>
            <button
              type="button"
              className="solo-button"
              onClick={() => onReleaseSeat()}
            >
              Освободить место
            </button>
          </>
        ) : (
          <button
            type="button"
            className="play-button"
            onClick={() => onSit(picked)}
          >
            <Play fill="currentColor" /> Сесть за {TEAMS[picked].name}
          </button>
        )}
        <button type="button" className="solo-button" onClick={onBeginSolo}>
          Играть одному за синих
        </button>
        {lobby?.mutatorBanner && (
          <p className="lobby-mutator">{lobby.mutatorBanner}</p>
        )}
        {seat &&
          lobby?.startAt != null &&
          (clock || Date.now()) < lobby.startAt - 3000 && (
            <div className="lobby-chaos-ban">
              <b>Бан хаоса (до 2 типов, 30 с)</b>
              <div className="lobby-chaos-ban-grid">
                {CHAOS_EFFECT_KINDS.map((kind) => {
                  const on = banDraft.includes(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={on ? 'on' : ''}
                      onClick={() => {
                        setBanDraft((prev) => {
                          if (prev.includes(kind))
                            return prev.filter((k) => k !== kind);
                          if (prev.length >= 2) return prev;
                          return [...prev, kind];
                        });
                      }}
                    >
                      {kind.replace(/^chaos_/, '').replaceAll('_', ' ')}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="solo-button"
                disabled={!banDraft.length}
                onClick={() => onChaosBan(banDraft)}
              >
                Сохранить бан
              </button>
              {lobby.chaosBans?.[seat.team]?.length ? (
                <small>
                  Ваш бан:{' '}
                  {lobby.chaosBans[seat.team]!
                    .map((k) => k.replace(/^chaos_/, ''))
                    .join(', ')}
                </small>
              ) : null}
            </div>
          )}
        {!!lobby?.seats.length && (
          <ul className="ready-list">
            {lobby.seats.map((s) => (
              <li key={s.team}>
                <i style={{ background: TEAMS[s.team].color }} />
                {s.name}
                <b>{s.away ? 'нет связи' : s.ready ? 'готов' : 'ждёт'}</b>
              </li>
            ))}
          </ul>
        )}
        <p>
          {lobby?.startAt
            ? `Все готовы. Общий старт через ${Math.max(1, Math.ceil((lobby.startAt - (clock || Date.now())) / 1000))} с.`
            : (lobby?.seats.length ?? 0) < 2
              ? 'Нужны минимум двое. Каждый выберите свой цвет и нажимает «Готов».'
              : 'Бой начнётся, когда готов каждый, кто сел за стол. Свободный цвет может занять друг. Пустой цвет станет ботом, только если к старту в нём нет человека.'}
        </p>
        <div className="start-rules">
          <span>
            <Flag /> Захватывай здания
          </span>
          <span>
            <Crown /> Удерживай лидерство
          </span>
          <span>
            <Sparkles /> Меняй правила
          </span>
        </div>
        <p>Первые 4 минуты — развитие. Затем власть у самого богатого.</p>
      </section>
      <div className="start-bottom">Каждый матч — новая история</div>
    </main>
  );
}
