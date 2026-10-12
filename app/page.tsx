'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BattlefieldLayer, type TowerHandlers } from '@/components/battlefield-layer';
import { TroopLayer } from '@/components/troop-layer';
import { OwnershipFilters } from '@/components/ownership-filters';
import {
  Settings,
  Eye,
  ArrowUp,
  Coins,
  Trees,
  Crosshair,
  Plus,
  Minus,
  Crown,
  Send,
  Sparkles,
  LockKeyhole,
  Check,
  ChevronRight,
  Flag,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { clampCamera, zoomCamera, type Camera } from '@/lib/camera';
import {
  advanceReplay,
  seekReplay,
  type Recording,
  type ReplayState,
} from '@/lib/replays';
import { CHAOS_EFFECT_KINDS, type ChaosEffectKind } from '@/lib/chaos-rules';
import {
  gameDecreeContextSeed,
  localDecreeCandidates,
  sanitizeDecreeCandidates,
  validPlayerDecree,
  type DecreeCandidate,
} from '@/lib/decrees';
import { applyPlay, type PlayAction } from '@/lib/play';
import { publishDrawSample } from '@/lib/draw-sample';
import { reactStamp, retainBattle } from '@/lib/live-view';
import {
  applyRoomTransport,
  type AppliedRoom,
  type RoomTransport,
} from '@/lib/room-protocol';
import {
  needsFullBootstrapRetry,
  ROOM_BOOTSTRAP_TIMEOUT_MS,
  safeRoomError,
  type RoomBootstrapState,
} from '@/lib/room-bootstrap';
import {
  DURATION,
  DEVELOPMENT_SECONDS,
  DECREE_RESPONSE_SECONDS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  TEAM_IDS,
  KIND_LABEL,
  income,
  workers,
  cannon,
  cannonCost,
  production,
  capacity,
  groupSize,
  upgradeCost,
  teamIncome,
  economicLeader,
  TEAMS,
  initialGame,
  tick,
  playerName,
  type Team,
  messageOpportunity,
  hasCannon,
  specialties,
  SPECIALTIES,
  type Tower,
  type Game,
} from '@/lib/tower-game';

const SEAT_STORAGE_KEY = 'tower-seat';

type SavedSeat = { playerId: string; team: Team; name: string };

function readSavedSeat(): SavedSeat | null {
  try {
    const raw = localStorage.getItem(SEAT_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SavedSeat>;
    if (typeof data.playerId !== 'string' || !data.playerId) return null;
    if (!TEAM_IDS.includes(data.team as Team)) return null;
    const name =
      typeof data.name === 'string' && data.name.trim()
        ? data.name.trim().slice(0, 16)
        : 'Игрок';
    return { playerId: data.playerId, team: data.team as Team, name };
  } catch {
    return null;
  }
}

function writeSavedSeat(seat: SavedSeat | null) {
  try {
    if (!seat) localStorage.removeItem(SEAT_STORAGE_KEY);
    else localStorage.setItem(SEAT_STORAGE_KEY, JSON.stringify(seat));
  } catch {}
}

export default function Home() {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 0.8 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [viewport, setViewport] = useState({ w: 1200, h: 800 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const field = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    camera: Camera;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const replayState = useRef<ReplayState | null>(null);
  const replayCarry = useRef(0);
  const savedLive = useRef<{
    game: ReturnType<typeof initialGame>;
    started: boolean;
  } | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState('');
  const [autoCamera, setAutoCamera] = useState(true);
  const replayLoad = useRef<AbortController | null>(null);
  const [routeMode, setRouteMode] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [debuffsEnabled, setDebuffsEnabled] = useState(false);
  const [scoutMode, setScoutMode] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [typingDeadline, setTypingDeadline] = useState(0);
  const [typingSeconds, setTypingSeconds] = useState(10);
  const [started, setStarted] = useState(false);
  const [seat, setSeat] = useState<{ id: string; team: Team } | null>(null);
  const [resumeState, setResumeState] = useState<RoomBootstrapState>('idle');
  const resumeStateRef = useRef<RoomBootstrapState>('idle');
  const [resumeAttempt, setResumeAttempt] = useState(0);
  const [callName, setCallName] = useState('Игрок');
  const [picked, setPicked] = useState<Team>('you');
  const [roomError, setRoomError] = useState('');
  const [lobby, setLobby] = useState<{
    seats: { name: string; team: Team; ready: boolean; away?: boolean }[];
    started: boolean;
    paused: boolean;
    startAt: number | null;
    game: Game | null;
    you: { team: Team; ready: boolean } | null;
    chaosBans?: Partial<Record<Team, ChaosEffectKind[]>>;
    mutatorBanner?: string;
  } | null>(null);
  const [banDraft, setBanDraft] = useState<ChaosEffectKind[]>([]);
  const [clock, setClock] = useState(0);
  const seatRef = useRef(seat);
  if (seat) seatRef.current = seat;
  function updateResumeState(next: RoomBootstrapState) {
    resumeStateRef.current = next;
    setResumeState(next);
  }
  const transportRef = useRef<AppliedRoom | null>(null);
  const sharedRef = useRef(false);
  const pushRef = useRef<(next: Game, force?: boolean) => void>(() => {});
  const ingestRef = useRef<(message: RoomTransport) => AppliedRoom | null>(() => null);
  const pausedRef = useRef(false);
  const roomPausedRef = useRef(false);
  const startedRef = useRef(false);
  const lobbyKeyRef = useRef('');
  const stampRef = useRef('');
  const shownRef = useRef<Game | null>(null);
  const towerHandlers = useRef<TowerHandlers>({
    tower: () => {},
    clear: () => {},
    scout: () => {},
  });
  const meRef = useRef<Team>('you');
  meRef.current = seat?.team ?? 'you';
  const [draft, setDraft] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<'local' | 'deepseek' | 'loading'>(
    'loading',
  );
  const [promptMessage, setPromptMessage] = useState('');
  const [candidates, setCandidates] = useState<DecreeCandidate[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const typingWindowEpoch = useRef<number | null>(null);
  const candidatesEpoch = useRef<number | null>(null);
  const spellFlight = useRef<{
    abort: AbortController;
    start: Promise<{ nonce: number | null; epoch: number | null; error?: string }>;
  } | null>(null);
  const [game, setGame] = useState(initialGame);
  const [selected, setSelected] = useState<number | null>(0);
  const [paused, setPaused] = useState(false);
  const [fraction, setFraction] = useState(0.5);
  const [speech, setSpeech] = useState(true);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    if (!started || paused || help) return;
    let handle = 0;
    let last = performance.now();
    let carry = 0;
    const update = (now: number) => {
      // Ignore tab suspension; bound catch-up work so a slow frame cannot snowball.
      carry += document.hidden ? 0 : Math.min((now-last)/1000, .15);
      last = now;
      const steps = Math.min(3, Math.floor((carry+1e-8)/.05));
      if (steps > 0) {
        carry -= steps*.05;
        if (recording && replayState.current) {
          replayCarry.current += steps*.05*replaySpeed;
          const replayStep = Math.floor((replayCarry.current+1e-8)/.05)*.05;
          if (replayStep > 0) {
            replayCarry.current -= replayStep;
            const next = advanceReplay(replayState.current,replayStep,recording);
            replayState.current=next;
            pushRef.current(next.game);
            if(next.game.age>=recording.duration)setPaused(true);
          }
        } else if (!sharedRef.current && !seatRef.current) {
          let g = gameRef.current;
          for (let i = 0; i < steps; i++) g = tick(g, 0.05);
          pushRef.current(g);
        }
      }
      handle=requestAnimationFrame(update);
    };
    handle=requestAnimationFrame(update);
    return () => cancelAnimationFrame(handle);
  }, [started, paused, help, recording, replaySpeed]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelected(null);
        setRouteMode(true);
        setHelp(false);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const gameRef = useRef(game);
  pausedRef.current = paused || help;
  startedRef.current = started;
  if (!shownRef.current) {
    shownRef.current = game;
    stampRef.current = reactStamp(game);
  }
  function pushGame(next: Game, force = false) {
    gameRef.current = next;
    publishDrawSample(next, pausedRef.current);
    const stamp = reactStamp(next);
    if (!force && stamp === stampRef.current) return;
    stampRef.current = stamp;
    const shown = retainBattle(shownRef.current ?? next, next);
    shownRef.current = shown;
    setGame(shown);
  }
  pushRef.current = pushGame;
  function ingest(message: RoomTransport) {
    const data = applyRoomTransport(transportRef.current, message);
    if (!data) {
      transportRef.current = null;
      return null;
    }
    transportRef.current = data;
    if (message.transport !== 'noop' && data.game) pushGame(data.game);
    return data;
  }
  ingestRef.current = ingest;
  const activeRef = useRef(false);
  activeRef.current = started && !paused && !help && !game.result && !recording;
  useLayoutEffect(() => {
    const saved = readSavedSeat();
    if (!saved) return;
    const next = { id: saved.playerId, team: saved.team };
    seatRef.current = next;
    setSeat(next);
    setCallName(saved.name);
    setPicked(saved.team);
    updateResumeState('loading');
  }, []);
  useEffect(() => {
    fetch('/api/decree')
      .then(async (r) => (await r.json()) as { provider?: string })
      .then((d) =>
        setProvider(d.provider === 'deepseek' ? 'deepseek' : 'local'),
      )
      .catch(() => setProvider('local'));
    return () => {
      pending.current?.abort();
      replayLoad.current?.abort();
    };
  }, []);
  useEffect(() => {
    let stop = false;
    let timer = 0;
    let ticket = 0;
    let misses = 0;
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
      const timeout =
        resumeStateRef.current === 'loading'
          ? window.setTimeout(() => controller.abort(), ROOM_BOOTSTRAP_TIMEOUT_MS)
          : 0;
      try {
        const query = new URLSearchParams();
        if (id) query.set('player', id);
        if (!full && transportRef.current?.cursor)
          query.set('cursor', transportRef.current.cursor);
        const response = await fetch(
          '/api/room' + (query.size ? `?${query}` : ''),
          { cache: 'no-store', signal: controller.signal },
        );
        const body = (await response.json()) as RoomTransport & {
          error?: string;
          code?: string;
        };
        return { response, body };
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
          const error = safeRoomError(message);
          setRoomError(error);
          if (booting) updateResumeState('error');
          return;
        }
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
            setRoomError('Не удалось получить полное состояние матча. Попробуйте ещё раз.');
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
          setRoomError('Не удалось связаться с комнатой за 10 секунд. Проверьте сеть и повторите.');
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
  }, [seat, resumeAttempt]);
  useEffect(() => {
    if (!lobby?.startAt || started) return;
    const timer = window.setInterval(() => setClock(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [lobby?.startAt, started]);
  useEffect(() => {
    const flight = spellFlight.current;
    if (!flight || flight.abort.signal.aborted) return;
    const g = gameRef.current;
    const matchEnded = !started || !!g.result;
    const lostLead = g.authority !== meRef.current;
    const halted = paused || help;
    if (!matchEnded && !lostLead && !halted) return;
    flight.abort.abort();
    const start = flight.start;
    spellFlight.current = null;
    pending.current = null;
    setBusy(false);
    setPromptMessage(
      matchEnded
        ? 'Матч завершён. Приказ отменён.'
        : halted
          ? 'Бой приостановлен. Приказ отменён.'
          : 'Вы потеряли лидерство. Приказ отменён.',
    );
    void (async () => {
      let nonce: number | null = null;
      try {
        nonce = (await start).nonce;
      } catch {
        nonce = null;
      }
      if (nonce == null) return;
      await play({ type: 'spell-cancel', nonce });
    })();
  }, [game.authority, game.result, paused, help, started]);
  const messageMode = !recording && messageOpportunity(game, meRef.current);
  const developing = game.age < DEVELOPMENT_SECONDS;
  useEffect(() => {
    if (!messageMode) setMessageDraft('');
  }, [messageMode]);
  useEffect(() => {
    if (!typingDeadline) return;
    const update = () => {
      const left = Math.max(0, (typingDeadline - Date.now()) / 1000);
      setTypingSeconds(left);
      if (left === 0) {
        setTypingDeadline(0);
        setDraft('');
        setCandidates([]);
        setShowCustom(false);
        setPromptMessage('30 секунд на указ истекли. Право ждёт следующего лидера.');
      }
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [typingDeadline]);
  useEffect(() => {
    if (!started || game.result || game.authority !== meRef.current) {
      typingWindowEpoch.current = null;
      candidatesEpoch.current = null;
      setTypingDeadline(0);
      setTypingSeconds(DECREE_RESPONSE_SECONDS);
      setDraft('');
      setCandidates([]);
      setShowCustom(false);
    }
  }, [game.authority, game.result, started, seat?.team]);
  useEffect(() => {
    if (
      started &&
      !game.result &&
      !developing &&
      game.authority === meRef.current &&
      !typingDeadline &&
      typingWindowEpoch.current !== game.authorityEpoch
    ) {
      const secondsLeft = Math.max(
        0,
        game.leaderSince + DECREE_RESPONSE_SECONDS - game.age,
      );
      if (!secondsLeft) return;
      typingWindowEpoch.current = game.authorityEpoch;
      candidatesEpoch.current = game.authorityEpoch;
      setTypingDeadline(Date.now() + secondsLeft * 1000);
      setTypingSeconds(secondsLeft);
      setShowCustom(false);
      setDraft('');
      setPromptMessage('');
      const leader = game.authority;
      if (leader) {
        const seed = gameDecreeContextSeed({
          elapsed: game.elapsed,
          towers: game.towers.filter((t) => t.team === leader).length,
          earned: game.wallets[leader].earned,
          epoch: game.authorityEpoch,
        });
        setCandidates(
          localDecreeCandidates(seed, game.bannedChaos ?? []),
        );
        void refreshDecreeCandidates(seed, game.authorityEpoch);
      }
    }
  }, [
    started,
    game.result,
    game.authority,
    game.authorityEpoch,
    game.leaderSince,
    game.age,
    game.elapsed,
    game.towers,
    game.wallets,
    developing,
    typingDeadline,
  ]);
  useEffect(() => {
    if (
      !started ||
      game.result ||
      game.authority !== meRef.current ||
      !game.spell ||
      game.spell.patch
    )
      return;
    const epoch = game.authorityEpoch;
    const seed =
      gameDecreeContextSeed({
        elapsed: game.elapsed,
        towers: game.towers.filter((t) => t.team === game.authority).length,
        earned: game.wallets[game.authority!].earned,
        epoch,
      }) + `#${game.spellCandidateSeed ?? 0}`;
    setCandidates(localDecreeCandidates(seed, game.bannedChaos ?? []));
    void refreshDecreeCandidates(seed, epoch);
  }, [game.spellCandidateSeed, game.spell?.startedAt, started]);
  async function refreshDecreeCandidates(seed: string, epoch: number) {
    const request = new AbortController();
    pending.current?.abort();
    pending.current = request;
    setBusy(true);
    try {
      const response = await fetch('/api/decree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'candidates',
          context: seed,
          banned: gameRef.current.bannedChaos ?? [],
        }),
        signal: request.signal,
      });
      const data = (await response.json()) as {
        error?: string;
        provider?: string;
        candidates?: unknown;
      };
      if (pending.current !== request || request.signal.aborted) return;
      if (gameRef.current.authorityEpoch !== epoch) return;
      if (!response.ok) {
        if (data.error) setPromptMessage(data.error);
        return;
      }
      if (data.provider === 'deepseek') setProvider('deepseek');
      const available = sanitizeDecreeCandidates(data.candidates);
      if (available.length === 3) {
        setCandidates(available);
        setPromptMessage('Выберите один из трёх указов или напишите свой.');
      }
    } catch {
      if (
        !request.signal.aborted &&
        gameRef.current.authorityEpoch === epoch
      )
        setPromptMessage(
          'Не удалось обновить варианты. Локальные карточки остаются.',
        );
    } finally {
      if (pending.current === request) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    if (
      !started ||
      game.result ||
      developing ||
      game.authority !== meRef.current ||
      !typingDeadline ||
      paused ||
      help ||
      game.spell
    )
      return;
    const epoch = game.authorityEpoch;
    if (candidatesEpoch.current === epoch && candidates.length === 3) return;
    if (candidatesEpoch.current === epoch) return;
    candidatesEpoch.current = epoch;
    setShowCustom(false);
    setDraft('');
    const leader = game.authority;
    if (!leader) return;
    const seed = gameDecreeContextSeed({
      elapsed: game.elapsed,
      towers: game.towers.filter((t) => t.team === leader).length,
      earned: game.wallets[leader].earned,
      epoch,
    });
    setCandidates(
      localDecreeCandidates(seed, gameRef.current.bannedChaos ?? []),
    );
    void refreshDecreeCandidates(seed, epoch);
  }, [
    started,
    game.result,
    developing,
    game.authority,
    game.authorityEpoch,
    typingDeadline,
    paused,
    help,
    game.spell,
    game.elapsed,
    game.towers,
    game.wallets,
    candidates.length,
  ]);
  const blockPaste = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setPromptMessage('Приказ нужно набрать вручную. Вставка отключена.');
  };
  function focusPoint(x: number, y: number, zoom = cameraRef.current.zoom) {
    const v = viewportRef.current;
    setCamera(
      clampCamera(
        {
          x: v.w / 2 - (x / 100) * WORLD_WIDTH * zoom,
          y: v.h * 0.46 - (y / 100) * WORLD_HEIGHT * zoom,
          zoom,
        },
        v.w,
        v.h,
        WORLD_WIDTH,
        WORLD_HEIGHT,
      ),
    );
  }
  function focusHome() {
    const home =
      gameRef.current.towers.find((t) => t.team === meRef.current && t.home) ??
      gameRef.current.towers[0];
    focusPoint(home.x, home.y, viewportRef.current.w < 600 ? 0.65 : 0.8);
  }
  function changeZoom(multiplier: number) {
    const v = viewportRef.current;
    setCamera((c) =>
      zoomCamera(
        c,
        c.zoom * multiplier,
        v.w / 2,
        v.h / 2,
        v.w,
        v.h,
        WORLD_WIDTH,
        WORLD_HEIGHT,
      ),
    );
  }
  useEffect(() => {
    if (!started || !field.current) return;
    const el = field.current;
    const resize = () => {
      const v = { w: el.clientWidth, h: el.clientHeight };
      viewportRef.current = v;
      setViewport(v);
      if (!initialized.current) {
        initialized.current = true;
        focusHome();
      } else
        setCamera((c) => clampCamera(c, v.w, v.h, WORLD_WIDTH, WORLD_HEIGHT));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect(),
        v = viewportRef.current;
      setCamera((c) =>
        zoomCamera(
          c,
          c.zoom * Math.exp(-e.deltaY * 0.001),
          e.clientX - rect.left,
          e.clientY - rect.top,
          v.w,
          v.h,
          WORLD_WIDTH,
          WORLD_HEIGHT,
        ),
      );
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  }, [started]);
  function panStart(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.button !== 1) return;
    suppressClick.current = false;
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      camera: cameraRef.current,
      moved: false,
    };
  }
  function panMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    suppressClick.current = true;
    if (!e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.setPointerCapture(e.pointerId);
    const v = viewportRef.current;
    setCamera(
      clampCamera(
        { ...d.camera, x: d.camera.x + dx, y: d.camera.y + dy },
        v.w,
        v.h,
        WORLD_WIDTH,
        WORLD_HEIGHT,
      ),
    );
  }
  function panEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  }
  const me: Team = seat?.team ?? 'you';
  meRef.current = me;
  const source = game.towers.find((t) => t.id === selected && t.team === me);
  const decreeWindowOpen =
    game.age < game.leaderSince + DECREE_RESPONSE_SECONDS;
  const canIssueDecree =
    !roomError && !developing && decreeWindowOpen && game.authority === me;
  const decreeOverlayOpen =
    canIssueDecree &&
    !!typingDeadline &&
    !paused &&
    !help &&
    !game.spell;
  const developmentLeft = Math.max(
    0,
    Math.ceil(DEVELOPMENT_SECONDS - game.age),
  );
  const money = game.wallets[me];
  const rates = teamIncome(game, me);
  const totalEarned = TEAM_IDS.reduce((n, t) => n + game.wallets[t].earned, 0);
  const currentLeader = economicLeader(game);
  const cost = source ? upgradeCost(source) : null;
  const gunCost = source ? cannonCost(source) : null;
  const auto = game.automation.find((a) => a.from === source?.id);
  const remaining = Math.max(0, Math.ceil(DURATION - game.elapsed));
  const yours = game.towers.filter((t) => t.team === me);
  const chapter = recording
    ? recording.chapters.filter((c) => c.at <= game.age).at(-1)
    : undefined;
  const recordedTyping = recording?.typing.find(
    (t) => t.start <= game.age && t.end > game.age,
  );
  useEffect(() => {
    if (recording && chapter && autoCamera)
      focusPoint(
        chapter.x,
        chapter.y,
        Math.min(
          chapter.zoom,
          viewportRef.current.w < 600 ? 0.5 : chapter.zoom,
        ),
      );
  }, [recording, chapter?.at, autoCamera]);
  function seekRecording(time: number) {
    if (!recording) return;
    replayCarry.current = 0;
    const next = seekReplay(recording, time);
    replayState.current = next;
    pushGame(next.game, true);
  }
  function leaveRecording() {
    const saved = savedLive.current;
    setRecording(null);
    replayState.current = null;
    pushGame(saved?.game ?? initialGame(), true);
    setStarted(saved?.started ?? false);
    setPaused(!!saved?.started);
    setShowSettings(false);
    setSelected(null);
    savedLive.current = null;
  }
  const settingsPanel = (
    <div className="settings-popover">
      <b>Настройки</b>
      <label>
        <input
          type="checkbox"
          checked={debuffsEnabled}
          onChange={(e) => {
            setDebuffsEnabled(e.target.checked);
            try {
              localStorage.setItem(
                'tower-debuffs',
                e.target.checked ? 'on' : 'off',
              );
            } catch {}
          }}
        />{' '}
        Рулетка штрафов · 50%
      </label>
      <small>Рулетка требует собственного ключа DeepSeek.</small>
    </div>
  );
  const reset = () => {
    replayLoad.current?.abort();
    setReplayLoading(false);
    if (recording) {
      leaveRecording();
      return;
    }
    pending.current?.abort();
    pending.current = null;
    if (seatRef.current) {
      void fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'leave', playerId: seatRef.current.id }),
      });
      writeSavedSeat(null);
      seatRef.current = null;
      transportRef.current = null;
      setSeat(null);
      updateResumeState('idle');
    }
    sharedRef.current = false;
    setBusy(false);
    setDraft('');
    setPromptMessage('');
    pushGame(initialGame(), true);
    setSelected(null);
    setScoutMode(false);
    setRouteMode(true);
    initialized.current = false;
    setPaused(false);
    setHelp(false);
    setStarted(false);
  };
  const begin = () => {
    try {
      setDebuffsEnabled(localStorage.getItem('tower-debuffs') === 'on');
    } catch {}
    sharedRef.current = false;
    reset();
    setStarted(true);
    focusPoint(18, 20, viewportRef.current.w < 600 ? 0.65 : 0.8);
  };
  async function roomPost(body: Record<string, unknown>) {
    type RoomPostResponse = {
      error?: string;
      code?: string;
      playerId?: string;
      team?: Team;
      started?: boolean;
      paused?: boolean;
      seats?: { name: string; team: Team; ready: boolean }[];
      you?: { team: Team; ready: boolean } | null;
      startAt?: number | null;
      spellNonce?: number | null;
      spellEpoch?: number | null;
      transport?: RoomTransport;
    };
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      ROOM_BOOTSTRAP_TIMEOUT_MS,
    );
    try {
      const response = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          cursor: transportRef.current?.cursor,
        }),
        signal: controller.signal,
      });
      const data = (await response.json()) as RoomPostResponse;
      if (!response.ok) {
        const error = safeRoomError(data);
        setRoomError(error);
        return { ...data, error };
      }
      if (data.transport) {
        const applied = ingest(data.transport);
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
  async function sit(team: Team) {
    setRoomError('');
    const data = await roomPost({
      op: 'join',
      team,
      name: callName,
      playerId: seatRef.current?.id,
    });
    if (data.error || !data.playerId || !data.team) {
      setRoomError(data.error || 'Не удалось занять цвет.');
      return;
    }
    const next = { id: data.playerId, team: data.team };
    const name = callName.trim().slice(0, 16) || 'Игрок';
    transportRef.current = null;
    seatRef.current = next;
    meRef.current = data.team;
    setSeat(next);
    setPicked(data.team);
    updateResumeState('idle');
    writeSavedSeat({ playerId: data.playerId, team: data.team, name });
  }
  async function releaseSeat() {
    if (!seatRef.current) return;
    setRoomError('');
    const data = await roomPost({ op: 'leave', playerId: seatRef.current.id });
    if (data.error) {
      setRoomError(data.error);
      return;
    }
    writeSavedSeat(null);
    seatRef.current = null;
    transportRef.current = null;
    sharedRef.current = false;
    setSeat(null);
    updateResumeState('idle');
    setStarted(false);
    setPaused(false);
    pushGame(initialGame(), true);
  }
  async function toggleReady() {
    if (!seatRef.current) return;
    setRoomError('');
    const data = await roomPost({ op: 'ready', playerId: seatRef.current.id });
    if (data.error) setRoomError(data.error);
  }
  function play(action: PlayAction) {
    const actor = meRef.current;
    if (sharedRef.current && seatRef.current) {
      return roomPost({
        op: 'action',
        playerId: seatRef.current.id,
        action,
      }).then((data) => ({
        nonce: typeof data.spellNonce === 'number' ? data.spellNonce : null,
        epoch: typeof data.spellEpoch === 'number' ? data.spellEpoch : null,
        error: typeof data.error === 'string' ? data.error : undefined,
        code: typeof data.code === 'string' ? data.code : undefined,
      }));
    }
    const next = applyPlay(gameRef.current, actor, action);
    pushGame(next, true);
    return Promise.resolve({
      nonce: next.spell?.nonce ?? null,
      epoch: next.spell?.epoch ?? null,
      error: undefined as string | undefined,
      code: undefined as string | undefined,
    });
  }
  const clickTower = (t: Tower) => {
    if (
      t.ruinedAt !== undefined ||
      recording ||
      paused ||
      help ||
      game.result ||
      suppressClick.current
    )
      return;
    if (scoutMode && source) {
      play({ type: 'scout', from: source.id, x: t.x, y: t.y });
      setScoutMode(false);
      return;
    }
    if (routeMode && source && source.id !== t.id) {
      play({ type: 'route', from: source.id, to: t.id });
      setSelected(null);
      return;
    }
    if (source && source.id !== t.id) {
      play({ type: 'army', from: source.id, to: t.id, fraction });
      setSelected(null);
    } else if (t.team === me) setSelected(t.id);
    else
      pushGame(
        {
          ...gameRef.current,
          notice: 'Сначала выберите свою башню, затем нажмите на цель.',
        },
        true,
      );
  };
  const onTowerClick = (t: Tower) => {
    if (
      t.ruinedAt !== undefined ||
      recording ||
      paused ||
      help ||
      game.result ||
      suppressClick.current
    )
      return;
    if (source && source.id === t.id) {
      setSelected(null);
      return;
    }
    clickTower(t);
  };
  towerHandlers.current.tower = onTowerClick;
  towerHandlers.current.clear = () => setSelected(null);
  towerHandlers.current.scout = (from, x, y) => {
    play({ type: 'scout', from, x, y });
  };
  async function selectCandidate(candidate: DecreeCandidate) {
    const current = gameRef.current;
    if (
      !typingDeadline ||
      Date.now() >= typingDeadline ||
      current.authority !== me ||
      current.age >= current.leaderSince + DECREE_RESPONSE_SECONDS ||
      current.result ||
      current.spell ||
      !validPlayerDecree(candidate.patch)
    )
      return;
    setBusy(true);
    const start = play({
      type: 'spell-start',
      text: candidate.title,
      roll: 'disabled',
    });
    spellFlight.current = { abort: new AbortController(), start };
    try {
      const begun = await start;
      if (begun.nonce == null || typeof begun.epoch !== 'number') {
        setPromptMessage(begun.error || 'Лидерство уже у другого.');
        return;
      }
      await play({
        type: 'spell-ready',
        patch: candidate.patch,
        epoch: begun.epoch,
        debuff: null,
        roll: 'disabled',
      });
      setTypingDeadline(0);
      setCandidates([]);
      setDraft('');
      setPromptMessage('Указ объявлен. Удержите лидерство до исполнения.');
    } finally {
      spellFlight.current = null;
      setBusy(false);
    }
  }
  async function submitCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !typingDeadline || Date.now() >= typingDeadline) return;
    setBusy(true);
    try {
      const response = await fetch('/api/decree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'custom', prompt: draft.trim() }),
      });
      const data = (await response.json()) as {
        error?: string;
        custom?: unknown;
      };
      const custom = data.custom as DecreeCandidate | undefined;
      if (
        !response.ok ||
        !custom ||
        typeof custom.title !== 'string' ||
        !validPlayerDecree(custom.patch)
      ) {
        setPromptMessage(data.error || 'Своя формулировка не подходит правилам указа.');
        return;
      }
      await selectCandidate(custom);
    } catch {
      setPromptMessage('Не удалось проверить свою формулировку.');
    } finally {
      setBusy(false);
    }
  }
  async function submitMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = messageDraft.trim();
    if (!text || recording || paused || help || gameRef.current.result) return;
    if (!messageOpportunity(gameRef.current, meRef.current)) return;
    await play({ type: 'message', text });
    setMessageDraft('');
    setPromptMessage('Сообщение над штабом · 10 секунд');
  }
  const retryRestore = () => {
    setRoomError('');
    updateResumeState('loading');
    setResumeAttempt((attempt) => attempt + 1);
  };
  const returnToLobby = () => {
    writeSavedSeat(null);
    seatRef.current = null;
    transportRef.current = null;
    sharedRef.current = false;
    setSeat(null);
    setStarted(false);
    updateResumeState('idle');
  };
  if (!started && resumeState !== 'idle')
    return (
      <main className="start-screen">
        <div className="start-cloud">
          <span>СТРАТЕГИЯ, В КОТОРОЙ ВЛАСТЬ МЕНЯЕТ ПРАВИЛА</span>
        </div>
        <section className="start-panel">
          <p>
            {resumeState === 'loading'
              ? 'Возвращаем вас в матч…'
              : 'Не удалось вернуться в матч.'}
          </p>
          {roomError && <p className="room-error">{roomError}</p>}
          {resumeState === 'error' && (
            <div className="resume-actions">
              <button className="primary" onClick={retryRestore}>
                Повторить
              </button>
              <button className="resume-lobby" onClick={returnToLobby}>
                В лобби
              </button>
            </div>
          )}
        </section>
      </main>
    );
  if (!started)
    return (
      <main className="start-screen">
        {lobby?.startAt != null && (
          <div className="start-countdown">
            {Math.max(
              1,
              Math.ceil(
                (lobby.startAt - (clock || Date.now())) / 1000,
              ),
            )}
          </div>
        )}
        <div className="start-settings">
          <button
            className="square-button"
            aria-label="Настройки"
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
                      void sit(id);
                      return;
                    }
                    void roomPost({ op: 'leave', playerId: seat.id }).then((left) => {
                      if (left.error) {
                        setRoomError(left.error);
                        return;
                      }
                      writeSavedSeat(null);
                      if (seatRef.current?.id === seat.id) seatRef.current = null;
                      transportRef.current = null;
                      return sit(id);
                    });
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
                className={`play-button ${lobby?.you?.ready ? 'is-ready' : ''}`}
                onClick={() => void toggleReady()}
              >
                <Check /> {lobby?.you?.ready ? 'Отменить готовность' : 'Готов'}
              </button>
              <button className="solo-button" onClick={() => void releaseSeat()}>
                Освободить место
              </button>
            </>
          ) : (
            <button className="play-button" onClick={() => void sit(picked)}>
              <Play fill="currentColor" /> Сесть за {TEAMS[picked].name}
            </button>
          )}
          <button className="solo-button" onClick={begin}>
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
                  onClick={() =>
                    void roomPost({
                      op: 'chaos-ban',
                      playerId: seat.id,
                      kinds: banDraft,
                    })
                  }
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
                ? 'Нужны минимум двое. Каждый выбирает свой цвет и нажимает «Готов».'
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
  return (
    <main className="war-shell">
      <OwnershipFilters />
      <header className="war-header">
        <a className="war-brand" href="/">
          FORGE<span>OF WILL</span>
        </a>
        <div className="chapter">
          <span>01</span>
          <div>
            <small>ПЕРВАЯ ЭКСПЕДИЦИЯ</small>
            <b>Солнечная долина</b>
          </div>
        </div>
      </header>
      <div className="hud-corner">
        <div className="header-actions">
          <button
            className="square-button"
            aria-label="Настройки"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings size={17} />
          </button>
          {showSettings && settingsPanel}
          <button
            aria-pressed={showStats}
            onClick={() => setShowStats(!showStats)}
          >
            Статистика
          </button>
          <button disabled={!!recording} onClick={() => setHelp(true)}>
            Как играть
          </button>
          <button
            className="square-button"
            aria-label="Начать заново"
            title="Начать заново"
            onClick={reset}
          >
            <RotateCcw size={20} />
          </button>
        </div>
        <div className="battle-clock">
          <div className="clock">
            <i />
            {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, '0')}
          </div>
          <button
            className="square-button"
            aria-label={paused ? 'Продолжить' : 'Пауза'}
            disabled={!!game.result}
            onClick={() => {
              const next = !paused;
              if (sharedRef.current && seatRef.current) {
                roomPausedRef.current = next;
                setPaused(next);
                void roomPost({
                  op: 'pause',
                  playerId: seatRef.current.id,
                  paused: next,
                }).then((data) => {
                  if (data.error) {
                    roomPausedRef.current = !next;
                    setPaused(!next);
                  }
                });
                return;
              }
              setPaused(next);
            }}
          >
            {paused ? <Play size={19} /> : <Pause size={19} />}
          </button>
        </div>
        <nav className="camera-controls" aria-label="Управление картой">
          <button onClick={() => changeZoom(1.2)} aria-label="Приблизить">
            <Plus size={18} />
          </button>
          <span>{Math.round(camera.zoom * 100)}%</span>
          <button onClick={() => changeZoom(1 / 1.2)} aria-label="Отдалить">
            <Minus size={18} />
          </button>
          <button
            onClick={focusHome}
            title="К своему штабу"
            aria-label="К своему штабу"
          >
            <Crosshair size={18} />
          </button>
          <button
            onClick={() => {
              const v = viewportRef.current;
              focusPoint(50, 50, Math.min(v.w / WORLD_WIDTH, v.h / WORLD_HEIGHT));
            }}
          >
            Обзор
          </button>
        </nav>
      </div>
      <section className="dominion">
        <div className="dominion-heading">
          <span>
            <Crown size={20} />
            {developing
              ? `РАЗВИТИЕ · ${Math.floor(developmentLeft / 60)}:${String(developmentLeft % 60).padStart(2, '0')}`
              : 'ВЛАСТЬ ЭКОНОМИКИ'}
          </span>
          <b
            style={{
              color: currentLeader ? TEAMS[currentLeader].color : undefined,
            }}
          >
            {developing
              ? 'Промпты откроются через 4 минуты боя'
              : game.authority
                ? `Право: ${playerName(game, game.authority)}`
                : 'Равенство — право свободно'}
          </b>
        </div>
        <div
          className="dominion-bar"
          role="img"
          aria-label={TEAM_IDS.map(
            (t) =>
              `${playerName(game, t)}: ${Math.floor(game.wallets[t].earned)} очков`,
          ).join(', ')}
        >
          {TEAM_IDS.map((t) => (
            <span
              key={t}
              style={{
                width: `${totalEarned ? (game.wallets[t].earned / totalEarned) * 100 : 25}%`,
                background: TEAMS[t].color,
              }}
            >
              {Math.floor(game.wallets[t].earned)}
            </span>
          ))}
        </div>
      </section>
      <div className="economy-wallet">
        <span>
          <Coins />
          <b>{Math.floor(money.gold)}</b>
          <small>+{rates.gold.toFixed(1)}/с</small>
        </span>
        <span>
          <Trees />
          <b>{Math.floor(money.resources)}</b>
          <small>+{rates.resources.toFixed(1)}/с</small>
        </span>
        <p>Заработано: {Math.floor(money.earned)} очков</p>
      </div>
      <aside
        className={`economy-rank ${showStats ? 'is-open' : 'is-collapsed'}`}
      >
        <strong>ГОНКА ЭКОНОМИК</strong>
        {[...TEAM_IDS]
          .sort((a, b) => game.wallets[b].earned - game.wallets[a].earned)
          .map((t) => (
            <div key={t}>
              <i style={{ background: TEAMS[t].color }} />
              <span>
                {playerName(game, t)}
                <small>
                  {game.towers.filter((x) => x.team === t).length} зданий
                </small>
              </span>
              <b>{Math.floor(game.wallets[t].earned)}</b>
            </div>
          ))}
        <small>
          Золото + древесина за весь матч.
          <br />
          Улучшения не отнимают очки.
        </small>
      </aside>
      <button
        className="minimap"
        aria-label="Обзор карты: нажмите, чтобы переместить камеру"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          focusPoint(
            ((e.clientX - r.left) / r.width) * 100,
            ((e.clientY - r.top) / r.height) * 100,
          );
        }}
      >
        {game.towers.map((t) => (
          <i
            key={t.id}
            style={{
              left: `${t.x}%`,
              top: `${t.y}%`,
              background: t.team ? TEAMS[t.team].color : '#fff2c5',
            }}
          />
        ))}
        <span
          style={{
            left: `${(-camera.x / (WORLD_WIDTH * camera.zoom)) * 100}%`,
            top: `${(-camera.y / (WORLD_HEIGHT * camera.zoom)) * 100}%`,
            width: `${(viewport.w / (WORLD_WIDTH * camera.zoom)) * 100}%`,
            height: `${(viewport.h / (WORLD_HEIGHT * camera.zoom)) * 100}%`,
          }}
        />
      </button>

      <section
        className={`battle-card${
          game.epochBanner?.instant && game.epochBanner.until > game.age
            ? ' decree-reveal-shake'
            : ''
        }`}
      >
        {game.epochBanner && game.epochBanner.until > game.age && (
          <div
            className={`epoch-banner${
              game.epochBanner.instant ? ' epoch-banner--instant' : ''
            }`}
          >
            <Crown size={16} />
            <span>
              Эпоха {game.epochBanner.epoch} ·{' '}
              <b style={{ color: TEAMS[game.epochBanner.team].color }}>
                {playerName(game, game.epochBanner.team)}
              </b>
              : {game.epochBanner.title}
            </span>
          </div>
        )}
        <div className="battle-top">
          <div className="objective">
            <Flag size={19} />
            <b>
              {game.epochObjective && !developing
                ? game.epochObjective.label
                : 'Захватите долину'}
            </b>
            <span>
              {game.epochObjective && !developing
                ? game.epochObjective.done
                  ? 'Выполнено · бонус лидеру'
                  : `${Math.floor(game.epochObjective.progress)}/${game.epochObjective.target}`
                : 'Больше башен — ближе победа'}
            </span>
          </div>
          <div className="team-score">
            {Object.entries(TEAMS).map(([id, team]) => (
              <div
                key={id}
                style={{ '--color': team.color } as React.CSSProperties}
              >
                <i />
                <b>{playerName(game, id as Team)}</b>
                <span>{game.towers.filter((t) => t.team === id).length}</span>
                <small>
                  {id === me ? 'ВЫ' : (game.humans ?? ['you']).includes(id as Team) ? 'ИГРОК' : 'БОТ'}
                </small>
              </div>
            ))}
          </div>
        </div>
        <div
          ref={field}
          role="application"
          aria-label="Поле боя. Перетаскивание — камера, колесо — масштаб. Enter в режиме разведки отправляет разведчика в центр экрана."
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (
              e.key === 'Enter' &&
              scoutMode &&
              source &&
              !paused &&
              !help &&
              !game.result
            ) {
              e.preventDefault();
              play({
                type: 'scout',
                from: source.id,
                x:
                  ((viewport.w / 2 - camera.x) / camera.zoom / WORLD_WIDTH) *
                  100,
                y:
                  ((viewport.h / 2 - camera.y) / camera.zoom / WORLD_HEIGHT) *
                  100,
              });
              setScoutMode(false);
            }
          }}
          onPointerDown={panStart}
          onPointerMove={panMove}
          onPointerUp={panEnd}
          onPointerCancel={panEnd}
          onClick={(e) => {
            if (
              recording ||
              !scoutMode ||
              !source ||
              paused ||
              help ||
              game.result ||
              suppressClick.current ||
              (e.target as HTMLElement).closest('button')
            )
              return;
            const r = e.currentTarget.getBoundingClientRect();
            play({
              type: 'scout',
              from: source.id,
              x:
                ((e.clientX - r.left - camera.x) / camera.zoom / WORLD_WIDTH) *
                100,
              y:
                ((e.clientY - r.top - camera.y) / camera.zoom / WORLD_HEIGHT) *
                100,
            });
            setScoutMode(false);
          }}
          onClickCapture={(e) => {
            if (suppressClick.current) {
              e.stopPropagation();
              e.preventDefault();
            }
          }}
          className={`battlefield ${paused || help || game.result ? 'frozen' : ''}`}
        >
          <div className="map-caption">
            СОЛНЕЧНАЯ ДОЛИНА <span>36° N · 24° E</span>
          </div>
          <div
            className="world-map"
            style={
              {
                width: WORLD_WIDTH,
                height: WORLD_HEIGHT,
                transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
                '--label-scale': 1 / camera.zoom,
                '--chat-gap': `${42 / camera.zoom}px`,
              } as React.CSSProperties
            }
          >
            <div
              className="world-terrain"
              aria-hidden="true"
              style={{
                width: Math.max(
                  WORLD_WIDTH * 2.5,
                  WORLD_WIDTH + viewport.w / 0.35 + 400,
                ),
                height: Math.max(
                  WORLD_HEIGHT * 2.5,
                  WORLD_HEIGHT + viewport.h / 0.35 + 400,
                ),
              }}
            />
            <BattlefieldLayer
              game={game}
              me={me}
              selected={selected}
              speech={speech}
              routeMode={routeMode}
              scoutMode={scoutMode}
              paused={paused}
              help={help}
              recording={!!recording}
              handlers={towerHandlers}
            />
          </div>
          <div className="field-legend">
            <span>
              <i className="blue-dot" /> Ваши башни
            </span>
            <span>
              <i className="gray-dot" /> Нейтральные
            </span>
          </div>
          <button
            className="speech-toggle"
            onClick={() => setSpeech(!speech)}
            title={speech ? 'Скрыть реплики' : 'Показать реплики'}
            aria-label={speech ? 'Скрыть реплики' : 'Показать реплики'}
          >
            {speech ? <Volume2 size={18} /> : <VolumeX size={18} />} Реплики
          </button>
          <TroopLayer camera={camera} viewport={viewport} speech={speech} paused={paused || help} />
          {decreeOverlayOpen && (
            <div
              className="decree-overlay"
              role="dialog"
              aria-labelledby="decree-overlay-title"
              aria-modal="true"
            >
              <section className="decree-overlay-card">
                <header className="decree-overlay-head">
                  <span className="eyebrow">ПРАВО ЛИДЕРА</span>
                  <h2 id="decree-overlay-title">Ваш указ · 30 секунд</h2>
                  <span
                    className={`decree-overlay-timer ${typingSeconds <= 3 ? 'urgent' : ''}`}
                  >
                    {typingSeconds.toFixed(1)} с
                  </span>
                </header>
                {roomError && (
                  <p className="room-error" role="alert">
                    {roomError}
                  </p>
                )}
                {!showCustom ? (
                  <>
                    <p className="decree-overlay-lead">
                      Три готовых варианта с заранее показанным дополнительным
                      эффектом. Можно выбрать сразу — печатать тему не нужно.
                    </p>
                    <div className="decree-candidates decree-candidates--overlay">
                      {candidates.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          className="decree-candidate"
                          disabled={busy || !!game.spell}
                          onClick={() => void selectCandidate(candidate)}
                        >
                          <b>{candidate.title}</b>
                          <small>{candidate.flavor}</small>
                          <span>{candidate.description}</span>
                          <em>{candidate.sideEffect}</em>
                        </button>
                      ))}
                      <button
                        type="button"
                        className="decree-candidate decree-candidate--custom"
                        disabled={busy || !!game.spell}
                        onClick={() => {
                          setShowCustom(true);
                          setDraft('');
                        }}
                      >
                        <b>Написать свой приказ</b>
                        <small>Только ваш штаб и ваша команда.</small>
                        <span>Подкрепление, золото, древесина или щит.</span>
                      </button>
                    </div>
                    {busy && candidates.length < 3 && (
                      <p className="decree-overlay-status">Подгружаем варианты…</p>
                    )}
                  </>
                ) : (
                  <form
                    onSubmit={submitCustom}
                    className="custom-decree decree-overlay-custom"
                  >
                    <label htmlFor="custom-wish">
                      Свой указ: подкрепление, золото, древесина или щит для
                      вашей команды.
                    </label>
                    <div className="wish-input">
                      <textarea
                        id="custom-wish"
                        value={draft}
                        disabled={busy || !!game.spell}
                        onPaste={blockPaste}
                        onDrop={blockPaste}
                        onDragOver={(e) => e.preventDefault()}
                        onBeforeInput={(e) => {
                          if (
                            [
                              'insertFromPaste',
                              'insertFromDrop',
                              'insertFromYank',
                            ].includes((e.nativeEvent as InputEvent).inputType)
                          )
                            blockPaste(e);
                        }}
                        onKeyDown={(e) => {
                          if (
                            ((e.ctrlKey || e.metaKey) &&
                              e.key.toLowerCase() === 'v') ||
                            (e.shiftKey && e.key === 'Insert')
                          )
                            blockPaste(e);
                        }}
                        onChange={(e) => setDraft(e.target.value)}
                        maxLength={350}
                        rows={3}
                        placeholder="Введите приказ…"
                        autoFocus
                      />
                      <button type="submit" disabled={busy || !draft.trim()}>
                        Проверить и исполнить
                      </button>
                    </div>
                    <button
                      type="button"
                      className="decree-back"
                      onClick={() => setShowCustom(false)}
                    >
                      ← К готовым вариантам
                    </button>
                  </form>
                )}
                <footer className="decree-overlay-foot">
                  <span>
                    {provider === 'deepseek'
                      ? 'DeepSeek может обновить карточки'
                      : provider === 'loading'
                        ? 'Проверяем связь…'
                        : 'Локальные варианты всегда доступны'}
                  </span>
                  {promptMessage && (
                    <p className="prompt-feedback" role="status">
                      {promptMessage}
                    </p>
                  )}
                </footer>
              </section>
            </div>
          )}
          {!recording && (paused || help || game.result) && (
            <div className="game-overlay">
              <section className="overlay-card">
                {help ? (
                  <>
                    <span className="eyebrow">
                      ЭКОНОМИКА · РАЗВЕДКА · ПРИКАЗЫ
                    </span>
                    <h1>Освойте долину</h1>
                    <ul className="new-help">
                      <li>
                        <Flag />
                        Своя башня → цель: постоянный маршрут. «Разово»
                        отправляет один отряд.
                      </li>
                      <li>
                        <Coins />
                        Шахты и лесопилки добывают ресурс по числу рабочих.
                        Караваны доставляют его в штаб — защищайте дорогу.
                      </li>
                      <li>
                        <Eye />
                        Глаз → точка карты: быстрый разведчик за 20🪙 и 10🪵
                        может перехватывать караваны.
                      </li>
                      <li>
                        <Crosshair />
                        Улучшайте башню и пушку отдельно. «Тактика» —
                        специализация, резерв и приоритет маршрута.
                      </li>
                      <li>
                        <Sparkles />
                        После 4 минут право промпта у лидера по доставленным
                        ресурсам. На ручной ввод 10 с, затем 6 с исполнения.
                        Потеря лидерства срывает приказ.
                      </li>
                      <li>
                        <Settings />
                        Рулетка: 50% на придуманный DeepSeek штраф. Выключается
                        шестерёнкой. Запрещено только прямое «я победил».
                      </li>
                    </ul>
                    <p>
                      Двигайте карту мышью или пальцем, масштаб — колесом.
                      События дают временные бонусы. Матч — 12 минут. Свободный
                      цвет может занять друг. Цвет без человека к старту играет
                      бот.
                    </p>
                    <button className="primary" onClick={() => setHelp(false)}>
                      Понятно, в бой! <ChevronRight size={18} />
                    </button>
                  </>
                ) : game.result ? (
                  <>
                    <span className="result-icon">
                      {game.result === me ? '🏆' : '⚑'}
                    </span>
                    <h1>
                      {game.result === me
                        ? 'Долина ваша!'
                        : game.result === 'draw'
                          ? 'Боевая ничья'
                          : `Победа: ${playerName(game, game.result)}`}
                    </h1>
                    <p>
                      Вы контролируете {yours.length} из {game.towers.length}{' '}
                      зданий.
                    </p>
                    <table className="earnings-table">
                      <tbody>
                        {TEAM_IDS.slice()
                          .sort(
                            (a, b) =>
                              (game.wallets[b]?.earned ?? 0) -
                              (game.wallets[a]?.earned ?? 0),
                          )
                          .map((team) => (
                            <tr key={team}>
                              <td>
                                <i style={{ background: TEAMS[team].color }} />
                                {playerName(game, team)}
                                {game.result === team ? ' · победа' : ''}
                              </td>
                              <td>{Math.floor(game.wallets[team]?.earned ?? 0)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    <button className="primary" onClick={() => {
                      if (sharedRef.current && seatRef.current) {
                        void roomPost({ op: 'reset', playerId: seatRef.current.id });
                        return;
                      }
                      begin();
                    }}>
                      Ещё один бой <RotateCcw size={18} />
                    </button>
                  </>
                ) : (
                  <>
                    <Pause size={32} />
                    <h1>Привал</h1>
                    <p>Бойцы ждут вашего приказа.</p>
                    <button
                      className="primary"
                      onClick={() => {
                        if (sharedRef.current && seatRef.current) {
                          void roomPost({
                            op: 'pause',
                            playerId: seatRef.current.id,
                            paused: false,
                          });
                          return;
                        }
                        setPaused(false);
                      }}
                    >
                      Продолжить <Play size={18} />
                    </button>
                    {seat && (
                      <button className="solo-button" onClick={() => void releaseSeat()}>
                        Освободить место
                      </button>
                    )}
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      </section>
      {!recording && (
        <section className="controls compact-controls">
          <div className="selected-summary">
            <b>
              {source
                ? `${source.home ? 'Штаб' : KIND_LABEL[source.kind]} · ${Math.floor(source.count)} 👤 · ур.${source.level}`
                : 'Выберите башню'}
            </b>
            {source && (
              <button
                aria-label="Снять выбор"
                onClick={() => setSelected(null)}
              >
                <X size={13} />
              </button>
            )}
          </div>
          {source && (
            <>
              <div className="compact-row segmented">
                <button
                  className={routeMode ? 'active' : ''}
                  onClick={() => {
                    setRouteMode(true);
                    setScoutMode(false);
                  }}
                >
                  ↻ Авто
                </button>
                <button
                  className={!routeMode ? 'active' : ''}
                  onClick={() => {
                    setRouteMode(false);
                    setScoutMode(false);
                  }}
                >
                  ➜ Разово
                </button>
                <button
                  className={scoutMode ? 'active' : ''}
                  title="Разведчик · 20 золота, 10 дерева · укажите точку на карте"
                  disabled={
                    money.gold < 20 ||
                    money.resources < 10 ||
                    paused ||
                    help ||
                    !!game.result
                  }
                  onClick={() => setScoutMode(!scoutMode)}
                >
                  <Eye size={15} />
                </button>
              </div>
              {source.team === me && (
                <button
                  className="recall-button"
                  disabled={
                    paused ||
                    help ||
                    !!game.result ||
                    !game.troops.some(
                      (p) =>
                        p.team === me &&
                        p.from === source.id &&
                        !p.cargo &&
                        !p.haul &&
                        !p.scoutUntil &&
                        p.progress < 1,
                    )
                  }
                  onClick={() => play({ type: 'recall', from: source.id })}
                >
                  Вернуть войска
                </button>
              )}
              {!routeMode && (
                <div className="compact-row segmented">
                  {[0.5, 1].map((n) => (
                    <button
                      key={n}
                      className={fraction === n ? 'active' : ''}
                      onClick={() => setFraction(n)}
                    >
                      {n * 100}%
                    </button>
                  ))}
                </div>
              )}
              <div className="compact-row">
                <button
                  className="upgrade-button"
                  title={`Вместимость ${capacity(source)} · группа ${groupSize(source)}`}
                  disabled={
                    source.level >= 5 ||
                    money.gold < cost!.gold ||
                    money.resources < cost!.resources ||
                    paused ||
                    help ||
                    !!game.result
                  }
                  onClick={() => play({ type: 'upgrade', id: source.id })}
                >
                  <ArrowUp size={16} />
                  <span>
                    Башня
                    <small>
                      {source.level >= 5
                        ? 'MAX'
                        : `${cost!.gold}🪙 ${cost!.resources}🪵`}
                    </small>
                  </span>
                </button>
                {hasCannon(source) && (
                  <button
                    className="upgrade-button"
                    title={`Урон ${cannon(source).damage} · перезарядка ${cannon(source).interval.toFixed(1)} с`}
                    disabled={
                      cannon(source).level >= 5 ||
                      money.gold < gunCost!.gold ||
                      money.resources < gunCost!.resources ||
                      paused ||
                      help ||
                      !!game.result
                    }
                    onClick={() => play({ type: 'cannon', id: source.id })}
                  >
                    <Crosshair size={16} />
                    <span>
                      Пушка {cannon(source).level}
                      <small>
                        {cannon(source).level >= 5
                          ? 'MAX'
                          : `${gunCost!.gold}🪙 ${gunCost!.resources}🪵`}
                      </small>
                    </span>
                  </button>
                )}
              </div>
              <details className="advanced-controls">
                <summary>
                  Тактика {auto ? '· ↻' : ''} {source.specialty ? '· ★' : ''}
                </summary>
                <small>
                  {production(source) > 0
                    ? `Набор ${production(source).toFixed(1)}/с`
                    : `Добыча ${(income(source).gold + income(source).resources).toFixed(1)}/с · ${workers(source)} рабочих`}
                </small>
                {source.specialty ? (
                  <p>{SPECIALTIES[source.specialty]}</p>
                ) : (
                  <>
                    <small>Специализация · ур.2 · 80🪙 60🪵</small>
                    <div className="compact-row">
                      {specialties(source).map((choice) => (
                        <button
                          key={choice}
                          disabled={
                            source.level < 2 ||
                            money.gold < 80 ||
                            money.resources < 60 ||
                            paused ||
                            help ||
                            !!game.result
                          }
                          onClick={() =>
                            play({ type: 'specialize', id: source.id, choice })
                          }
                        >
                          {SPECIALTIES[choice]}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {auto && (
                  <>
                    <select
                      aria-label="Приоритет маршрута"
                      value={auto.mode ?? 'assault'}
                      disabled={paused || help || !!game.result}
                      onChange={(e) =>
                        play({
                          type: 'route-config',
                          from: source.id,
                          mode: e.target.value as 'assault' | 'supply' | 'excess',
                          reserve: auto.reserve ?? 5,
                        })
                      }
                    >
                      <option value="assault">Атаковать</option>
                      <option value="supply">Пополнять до 50</option>
                      <option value="excess">Только избыток (&gt;75%)</option>
                    </select>
                    <label>
                      Резерв{' '}
                      <input
                        type="number"
                        min="0"
                        max="1000"
                        value={auto.reserve ?? 5}
                        disabled={paused || help || !!game.result}
                        onChange={(e) =>
                          play({
                            type: 'route-config',
                            from: source.id,
                            mode: auto.mode ?? 'assault',
                            reserve: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <button
                      disabled={paused || help || !!game.result}
                      onClick={() =>
                        play({ type: 'route', from: source.id, to: null })
                      }
                    >
                      Стоп → №{auto.to + 1}
                    </button>
                  </>
                )}
              </details>
            </>
          )}
        </section>
      )}
            <div className="hud-notifications" aria-live="polite">
        <div className="battle-notice">
          <span className="notice-dot" />
          <p>{game.notice}</p>
          <span className="captured-count">
            <Flag size={15} />
            {yours.length} / {game.towers.length}
          </span>
        </div>
      {game.event && !game.event.claimed && (
        <button
          className="event-notice"
          onClick={() => focusPoint(game.event!.x, game.event!.y)}
        >
          {game.event.kind === 'deposit'
            ? '💎 Жила ×3'
            : game.event.kind === 'fortress'
              ? '⚑ Форт +50'
              : '💰 Караван'}{' '}
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
      {game.minesweeper && game.age < game.minesweeper.until && (
        <aside className="replay-mines" aria-label="Сапёр соперников">
          {game.minesweeper.boards.map(board => {
            const elapsed = game.age-game.minesweeper!.start;
            const done = game.age >= board.finish;
            const mines = [3,11,17,22];
            const safe = Array.from({length:25},(_,i)=>i).filter(i=>!mines.includes(i));
            const opened = new Set(safe.slice(0, done && !board.failed ? 21 : Math.min(20,Math.floor(elapsed/(board.finish-game.minesweeper!.start)*21))));
            return <section key={board.team} className={done ? board.failed ? 'failed' : 'solved' : ''} style={{borderColor:TEAMS[board.team].color}}>
              <b style={{color:TEAMS[board.team].color}}>{playerName(game,board.team)}</b>
              <small>{done ? board.failed ? '💥 Мина · база уничтожена' : '✓ Поле пройдено' : `Сапёр · ${Math.max(0,Math.ceil(30-elapsed))} с`}</small>
              <div className="mine-grid">{Array.from({length:25},(_,i)=> {
                const n=mines.filter(m=>Math.abs(m%5-i%5)<=1 && Math.abs(Math.floor(m/5)-Math.floor(i/5))<=1).length;
                return <span key={i} className={opened.has(i) ? 'open' : ''}>{done && mines.includes(i) ? board.failed ? '💣' : '⚑' : opened.has(i) ? n || '' : ''}</span>;
              })}</div>
            </section>;
          })}
        </aside>
      )}
      {game.replayRoulette && game.replayRoulette.until > game.age && (
        <aside className={`rival-roulette ${game.replayRoulette.stage}`}>
          <div
            className={`roulette-disc ${game.replayRoulette.stage === 'spinning' ? '' : 'settled'}`}
          >
            {game.replayRoulette.stage === 'spinning' ? '?' : '☠'}
          </div>
          <div>
            <b>
              {game.replayRoulette.stage === 'spinning'
                ? 'Рулетка · 50 / 50'
                : game.replayRoulette.stage === 'submissions'
                  ? 'Соперники вводят дебаффы'
                  : 'Выбран дебафф'}
            </b>
            {game.replayRoulette.entries.map((entry, i) =>
              game.replayRoulette!.stage === 'submissions' &&
              (recording?.typing.find(
                (t) => t.team === entry.team && t.kind === 'debuff',
              )?.end ?? 0) > game.age ? null : (
                <p
                  key={entry.team}
                  className={
                    i === game.replayRoulette!.selected ? 'chosen' : ''
                  }
                >
                  <strong style={{ color: TEAMS[entry.team].color }}>
                    {playerName(game, entry.team)}:
                  </strong>{' '}
                  {entry.text}
                </p>
              ),
            )}
          </div>
        </aside>
      )}
      {(game.decreeChronicle?.length ?? 0) > 0 && (
        <aside className="decree-chronicle" aria-label="Хроника указов">
          <b>Хроника</b>
          <ul>
            {(game.decreeChronicle ?? []).slice(0, 5).map((row, i) => (
              <li key={`${row.epoch}-${row.at}-${i}`}>
                <i style={{ background: TEAMS[row.team].color }} />
                <span>
                  э.{row.epoch} · {playerName(game, row.team)} — {row.title}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      )}
      {game.matchMutator && (
        <div className="season-mutator-banner">{game.matchMutator.label}</div>
      )}
      {game.mapMutation && !developing && (
        <div className="map-mutation-hint">{game.mapMutation.label}</div>
      )}
      {game.spell &&
        !game.spell.patch &&
        game.authority &&
        game.authority !== me &&
        !game.teamVetoUsed?.[me] &&
        (game.humans ?? []).includes(me) && (
          <div className="decree-veto-bar">
            <span>Вето команды (1 раз за матч)</span>
            <button
              type="button"
              onClick={() => play({ type: 'decree-veto', mode: 'delay' })}
            >
              +10 с
            </button>
            <button
              type="button"
              onClick={() => play({ type: 'decree-veto', mode: 'reroll' })}
            >
              Перекинуть карты
            </button>
          </div>
        )}
      {game.announcement && game.announcement.until > game.age && (
        <output
          key={`${game.announcement.team}-${game.announcement.until}`}
          className="center-prompt"
        >
          <b style={{ color: TEAMS[game.announcement.team].color }}>
            {playerName(game, game.announcement.team)}:
          </b>{' '}
          {game.announcement.text}
        </output>
      )}
      {recording && (
        <>
          <div className="replay-chapter">
            <b>{chapter?.title}</b>
          </div>
          {recordedTyping && (
            <section className="wish-panel granted replay-typing">
              <div className="wish-heading">
                <h2>
                  {playerName(game, recordedTyping.team)} ·{' '}
                  Приказ
                </h2>
              </div>
              <div className="wish-input">
                <textarea
                  aria-label="Записанный ввод игрока"
                  readOnly
                  rows={2}
                  value={recordedTyping.text.slice(
                    0,
                    Math.floor(
                      recordedTyping.text.length *
                        Math.min(
                          1,
                          (game.age - recordedTyping.start) /
                            (recordedTyping.end - recordedTyping.start - 0.8),
                        ),
                    ),
                  )}
                />
                <button disabled>
                  <Send size={17} />{' '}
                  Исполнить
                </button>
              </div>
              <small>Игрок печатает…</small>
            </section>
          )}
          <div className="replay-controls">
            <button
              aria-label={paused ? 'Продолжить запись' : 'Приостановить запись'}
              onClick={() => {
                if (game.age >= recording.duration) seekRecording(0);
                setPaused(!paused);
              }}
            >
              {paused ? <Play size={18} /> : <Pause size={18} />}
            </button>
            <span>
              {Math.floor(game.age / 60)}:
              {String(Math.floor(game.age % 60)).padStart(2, '0')} /{' '}
              {Math.floor(recording.duration / 60)}:
              {String(recording.duration % 60).padStart(2, '0')}
            </span>
            <input
              aria-label="Перемотка записи"
              type="range"
              min={0}
              max={recording.duration}
              step={1}
              value={game.age}
              onChange={(e) => seekRecording(Number(e.target.value))}
            />
            <select
              aria-label="Скорость записи"
              value={replaySpeed}
              onChange={(e) => setReplaySpeed(Number(e.target.value))}
            >
              {[0.5, 1, 2, 4].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
            <button
              className={autoCamera ? 'active' : ''}
              title="Автоматическая камера"
              aria-pressed={autoCamera}
              onClick={() => setAutoCamera(!autoCamera)}
            >
              Камера
            </button>
            <button aria-label="Закрыть запись" onClick={leaveRecording}>
              <X size={18} />
            </button>
          </div>
          {game.result && (
            <div className="replay-winner">
              🏆{' '}
              {game.result && game.result !== 'draw'
                ? playerName(game, game.result)
                : ''}{' '}
              побеждает!
            </div>
          )}
        </>
      )}
      {!recording && (
        <section
          className={`wish-panel ${canIssueDecree || messageMode ? 'granted' : 'locked'}`}
        >
          <div className="wish-heading">
            <span className="wish-medal">
              {canIssueDecree || messageMode ? <Sparkles /> : <LockKeyhole />}
            </span>
            <div>
              <span className="eyebrow">ПРАВО ЛИДЕРА</span>
              <h2>
                {game.result
                  ? 'Битва завершена'
                  : canIssueDecree
                    ? 'Ваш приказ · 30 секунд'
                    : messageMode
                      ? 'Сообщение над штабом'
                      : developing
                        ? `Приказы через ${Math.floor(developmentLeft / 60)}:${String(developmentLeft % 60).padStart(2, '0')}`
                        : game.authority
                          ? `Лидер: ${playerName(game, game.authority)}`
                          : 'Обгони соперников по заработку'}
              </h2>
            </div>
            <span className="wish-status">
              {canIssueDecree
                ? '👑 ВАША ВЛАСТЬ'
                : messageMode
                  ? 'РЕПЛИКА'
                  : `${Math.floor(money.earned)} ОЧКОВ ЭКОНОМИКИ`}
            </span>
          </div>
          {(messageMode || canIssueDecree) &&
          !game.result ? (
            <>
            {canIssueDecree && (
              <p className="locked-description decree-corner-hint">
                {decreeOverlayOpen
                  ? 'Выбор указа — по центру поля боя. Удерживайте лидерство.'
                  : 'Окно указа откроется, когда вы станете единственным лидером.'}
              </p>
            )}
            {messageMode && (
              <form onSubmit={submitMessage}>
                <label htmlFor="hq-message">
                  Реплика над штабом на 10 секунд. Приказ лидера отправляется
                  отдельно.
                </label>
                <div className="wish-input">
                  <textarea
                    id="hq-message"
                    value={messageDraft}
                    disabled={paused || help}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    maxLength={350}
                    rows={2}
                    placeholder="Сообщение…"
                  />
                  <button
                    type="submit"
                    disabled={paused || help || !messageDraft.trim()}
                  >
                    <Send size={20} />
                    Сказать
                  </button>
                </div>
              </form>
            )}
            </>
          ) : (
            <p className="locked-description">
              {developing
                ? 'Добывайте и доставляйте ресурсы в штаб'
                : 'Право у лидера по заработку'}
            </p>
          )}
          {roomError && (
            <p className="room-error" role="alert">
              {roomError}
            </p>
          )}
          <p className="prompt-feedback" role="status">
            {promptMessage}
          </p>
          {game.decreeLog[0] && (
            <div className="last-decree">
              <Sparkles size={14} />
              <span>
                Последний указ:{' '}
                <b style={{ color: TEAMS[game.decreeLog[0].team].color }}>
                  {playerName(game, game.decreeLog[0].team)}
                </b>{' '}
                · {game.decreeLog[0].text}
              </span>
            </div>
          )}
        </section>
      )}
      <footer className="tips">
        <span>
          <span className={game.orders ? 'step complete' : 'step'}>
            {game.orders ? <Check size={13} /> : 1}
          </span>{' '}
          Отправьте первый отряд
        </span>
        <ChevronRight size={14} />
        <span>
          <span
            className={
              yours.some((t) => t.kind === 'supply') ? 'step complete' : 'step'
            }
          >
            2
          </span>{' '}
          Захватите снабжение
        </span>
        <ChevronRight size={14} />
        <span>
          <span className={game.result === me ? 'step complete' : 'step'}>
            3
          </span>{' '}
          Подчините долину
        </span>
        <small>
          {(game.humans?.length ?? 1) > 1
            ? 'Пустой цвет — бот, пока в нём нет человека'
            : 'Свободный цвет может занять друг. Пустой к старту — бот'}
        </small>
      </footer>
    </main>
  );
}
