'use client';

import { useEffect, type MutableRefObject } from 'react';
import type { AppliedRoom, RoomTransport } from '@/lib/room-protocol';
import {
  needsFullBootstrapRetry,
  ROOM_BOOTSTRAP_TIMEOUT_MS,
  safeRoomError,
  type RoomBootstrapState,
} from '@/lib/room-bootstrap';
import {
  buildRoomGetUrl,
  fetchRoomJson,
  isRoomBusy,
} from '@/lib/room-client';
import { initialGame, type Team } from '@/lib/tower-game';

export type RoomLobbyView = {
  seats: { name: string; team: Team; ready: boolean; away?: boolean }[];
  started: boolean;
  paused: boolean;
  startAt: number | null;
  you: { team: Team; ready: boolean } | null;
  mutatorBanner?: string;
  chaosBans?: Partial<Record<Team, import('@/lib/chaos-rules').ChaosEffectKind[]>>;
};

type RoomErrorBody = { error?: string; code?: string };

type RoomPostResponse = RoomTransport & {
  error?: string;
  code?: string;
  playerId?: string;
  team?: Team;
  started?: boolean;
  paused?: boolean;
  seats?: RoomLobbyView['seats'];
  you?: RoomLobbyView['you'];
  startAt?: number | null;
  spellNonce?: number | null;
  spellEpoch?: number | null;
  transport?: RoomTransport;
};

export type UseRoomTransportArgs = {
  seat: { id: string; team: Team } | null;
  resumeAttempt: number;
  resumeStateRef: MutableRefObject<RoomBootstrapState>;
  transportRef: MutableRefObject<AppliedRoom | null>;
  seatRef: MutableRefObject<{ id: string; team: Team } | null>;
  sharedRef: MutableRefObject<boolean>;
  startedRef: MutableRefObject<boolean>;
  roomPausedRef: MutableRefObject<boolean>;
  initialized: MutableRefObject<boolean>;
  ingestRef: MutableRefObject<(message: RoomTransport) => AppliedRoom | null>;
  pushRef: MutableRefObject<(next: import('@/lib/tower-game').Game, force?: boolean) => void>;
  lobbyKeyRef: MutableRefObject<string>;
  setLobby: (data: RoomLobbyView | null) => void;
  setRoomError: (msg: string) => void;
  setSeat: (seat: { id: string; team: Team } | null) => void;
  setStarted: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  updateResumeState: (s: RoomBootstrapState) => void;
  writeSavedSeat: (seat: null) => void;
};

export function useRoomTransport({
  seat,
  resumeAttempt,
  resumeStateRef,
  transportRef,
  seatRef,
  sharedRef,
  startedRef,
  roomPausedRef,
  initialized,
  ingestRef,
  pushRef,
  lobbyKeyRef,
  setLobby,
  setRoomError,
  setSeat,
  setStarted,
  setPaused,
  updateResumeState,
  writeSavedSeat,
}: UseRoomTransportArgs) {
  useEffect(() => {
    let stop = false;
    let timer = 0;
    let ticket = 0;
    let misses = 0;
    let busyStreak = 0;

    const clearReleasedSeat = (data: AppliedRoom) => {
      writeSavedSeat(null);
      sharedRef.current = false;
      seatRef.current = null;
      transportRef.current = null;
      setSeat(null);
      setStarted(false);
      setLobby(data);
      setRoomError('Место освобождено: связи не было больше 3 минут.');
      updateResumeState('idle');
    };

    const requestRoom = async (id: string | undefined, full = false) => {
      const controller = new AbortController();
      const booting = resumeStateRef.current === 'loading';
      const timeout = booting
        ? window.setTimeout(() => controller.abort(), ROOM_BOOTSTRAP_TIMEOUT_MS)
        : 0;
      try {
        const url = buildRoomGetUrl('/api/room', {
          playerId: id,
          cursor: transportRef.current?.cursor,
          full,
        });
        return await fetchRoomJson<RoomTransport & RoomErrorBody>(url, {
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        if (timeout) window.clearTimeout(timeout);
      }
    };

    const pull = async () => {
      const id = seatRef.current?.id;
      const mine = ++ticket;
      const booting = resumeStateRef.current === 'loading';
      try {
        let { response, body: message } = await requestRoom(id);
        if (stop || mine !== ticket) return;
        if (!response.ok) {
          if (isRoomBusy(response, message)) {
            busyStreak += 1;
            if (busyStreak < 12) return;
          }
          busyStreak = 0;
          const error = safeRoomError(message);
          setRoomError(error);
          if (booting) updateResumeState('error');
          return;
        }
        busyStreak = 0;
        let data = ingestRef.current(message);
        if (booting && needsFullBootstrapRetry(message, data)) {
          transportRef.current = null;
          ({ response, body: message } = await requestRoom(id, true));
          if (stop || mine !== ticket) return;
          if (!response.ok) {
            const error = safeRoomError(message);
            setRoomError(error);
            updateResumeState('error');
            return;
          }
          data = ingestRef.current(message);
          if (!data) {
            setRoomError(
              'Не удалось получить полное состояние матча. Попробуйте ещё раз.',
            );
            updateResumeState('error');
            return;
          }
        }
        if (!data) return;
        setRoomError('');
        if (id && seatRef.current?.id === id && !data.you) {
          if (booting || data.started) {
            clearReleasedSeat(data);
            return;
          }
          misses += 1;
          if (misses >= 3) clearReleasedSeat(data);
          return;
        }
        misses = 0;
        const lobbyKey = JSON.stringify({
          seats: data.seats,
          started: data.started,
          paused: data.paused,
          startAt: data.startAt,
          you: data.you,
        });
        if (lobbyKey !== lobbyKeyRef.current) {
          lobbyKeyRef.current = lobbyKey;
          setLobby(data);
        }
        if (seatRef.current && data.started && data.game) {
          if (!sharedRef.current) initialized.current = false;
          sharedRef.current = true;
          if (!startedRef.current) setStarted(true);
          if (roomPausedRef.current !== data.paused) {
            roomPausedRef.current = data.paused;
            setPaused(data.paused);
          }
          updateResumeState('idle');
        } else if (sharedRef.current && !data.started) {
          sharedRef.current = false;
          initialized.current = false;
          setStarted(false);
          pushRef.current(initialGame(), true);
          updateResumeState('idle');
        } else if (data.you) {
          updateResumeState('idle');
        }
      } catch {
        if (stop || mine !== ticket) return;
        if (booting) {
          setRoomError(
            'Не удалось связаться с комнатой за 10 секунд. Проверьте сеть и повторите.',
          );
          updateResumeState('error');
        }
      }
    };

    const arm = () => {
      window.clearTimeout(timer);
      const delay = document.hidden
        ? 8000
        : !seatRef.current
          ? 1000
          : sharedRef.current
            ? 80
            : 400;
      timer = window.setTimeout(() => {
        void pull().finally(() => {
          if (!stop) arm();
        });
      }, delay);
    };

    const onWake = () => {
      void pull();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
    void pull();
    arm();
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('pageshow', onWake);
    };
  }, [
    seat,
    resumeAttempt,
    resumeStateRef,
    transportRef,
    seatRef,
    sharedRef,
    startedRef,
    roomPausedRef,
    initialized,
    ingestRef,
    pushRef,
    lobbyKeyRef,
    setLobby,
    setRoomError,
    setSeat,
    setStarted,
    setPaused,
    updateResumeState,
    writeSavedSeat,
  ]);

  async function roomPost(body: Record<string, unknown>) {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      ROOM_BOOTSTRAP_TIMEOUT_MS,
    );
    try {
      const { response, body: data } = await fetchRoomJson<RoomPostResponse>(
        '/api/room',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            cursor: transportRef.current?.cursor,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const error = safeRoomError(data);
        setRoomError(error);
        return { ...data, error };
      }
      if (data.transport) {
        const applied = ingestRef.current(data.transport);
        if (applied && roomPausedRef.current !== applied.paused) {
          roomPausedRef.current = applied.paused;
          setPaused(applied.paused);
        }
        if (applied?.game && (applied.started || data.started)) {
          sharedRef.current = true;
          if (!startedRef.current) setStarted(true);
        }
      }
      return data;
    } catch {
      const error = 'Комната временно недоступна. Попробуйте ещё раз.';
      setRoomError(error);
      return { error, code: 'room_error' };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return { roomPost };
}
