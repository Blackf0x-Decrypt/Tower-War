# Tower War — план архитектуры v2

**Аудитория:** оператор продакшена (Vercel + Upstash), разработчики.  
**Контекст:** один публичный зал, HTTP long-poll, авторитетное состояние в Redis.  
**Live:** https://tower-war-xi.vercel.app/  
**Дата:** 2026-10-12  

**Связанный документ:** [troops-and-economy-spec.md](./troops-and-economy-spec.md) — детальная спецификация войск и экономики.

---

## 1. Зачем этот документ

Нужен **эволюционный** путь от текущего кода к «нормально работающей» игре: осмысленные типы войск, честная симметричная экономика, стабильный мультиплеер и управляемая сложность хаоса/приказов — **без** переписывания «с нуля в вакууме».

---

## 2. Текущее состояние (честно)

### 2.1 Что уже работает и стоит сохранить

| Область | Состояние |
|--------|-----------|
| **Симуляция** | `lib/tower-game.ts` (~2k строк): `tick(g, dt)`, захват, автомаршруты, боты для незанятых слотов, кошельки, события карты, приказы/хаос. |
| **Комната** | `lib/room.ts` + `lib/room-store.ts`: одна комната в Redis, lock `SET NX PX`, `revision`, журнал `troopJournal` для дельт. |
| **Протокол v2** | `lib/room-protocol.ts`: `full` / `delta` / `noop`, cursor (base64 JSON с хешами полей `Game`), компактные `TroopOp` (`d`/`m`/`s`/`u`). |
| **Действия игрока** | `lib/play.ts` — тонкий слой `PlayAction` → функции sim. |
| **Тесты** | `lib/room-store.test.ts` (~1.6k строк): lock, seat, delta/resync, troop journal, боты без стартового бонуса, API route. |
| **Рендер** | Canvas-слои (`troop-layer`, `battlefield-layer`), `draw-sample` — отделение отрисовки от React-DOM для войск. |
| **Опциональный AI** | `/api/decree` + DeepSeek для кастомных карточек приказов; локальный fallback в `decrees.ts`. |
| **Будущий транспорт** | `docs/cloudflare-room-migration.md` — DO + WebSocket, не ломая `/api/room`. |

### 2.2 Техдолг и «спaghetti»

1. **`app/page.tsx` (~2.7k строк)** — лобби, poll, seat, локальный preview/tick, UI приказов, настройки, replay, камера, экономика в HUD. Импортирует половину `tower-game` напрямую. Любое изменение sim/UI = риск регрессий.
2. **`Game` — god-object** — 40+ опциональных полей (minesweeper, replayRoulette, spell, chaos, epochObjective, …). Сложно тестировать изолированно и сериализовать дёшево.
3. **Хаос + legacy decrees** — 26 `chaos_*` + 14 legacy kinds в `decrees.ts`; эффекты размазаны: `chaos-rules.ts` (модификаторы в tick), `applyChaosInstant` в `tower-game.ts`, UI банов в room/page.
4. **Типы войск** — `variant`: line/heavy/scout/skirm; по факту **только** `variantSpeedMult` (+ спрайт в canvas). Нет ролей, контр-пиков, синка отдельного поля в wire (variant внутри `TroopWire` при spawn/update).
5. **Экономика** — двойная модель: HQ капает в `wallets`, шахты/лес копят `stockGold`/`stockWood` и **караваны**; казармы дают `production()` в `count`. Игроки путают «синий» (`team: 'you'`) с «мой цвет»; часть UI до join показывает `you` как синий.
6. **Симметрия карты** — `initialGame()` зеркалит координаты по квадрантам; **post-start** `bootstrapMatch` / map mutation / chaos могут ломать симметрию — это осознанный «хаос», но конфликтует с «fair ranked» ожиданиями.
7. **Perf / Redis** — cap JSON ~480k символов, trim shots/logs; при большом `troops[]` full snapshot дорогой; poll + lock → `room_busy` (503) при всплесках.
8. **Дeterminism** — `roomSeed`, decree seeds есть; полный replay hash sim **не** зафиксирован как контракт (float order, `Date.now()` в room advance).

### 2.3 Риски продакшена

- **Reload / seat:** `playerId` в localStorage, `SEAT_RELEASE_MS` 180s, `prepare()` может освободить место до join-resume → сообщение «3 минуты».
- **False kick / away:** `SEAT_AWAY_MS` 20s только для UI `away`, не для release.
- **room_busy:** GET `roomView` с `attempts=1` при lock → stale view без tick; клиент должен retry.
- **Delta gap:** cursor revision must be `r+1`; иначе full — клиент `room-bootstrap` + retry.

---

## 3. Целевая архитектура (слои)

```
┌─────────────────────────────────────────────────────────────┐
│  Client View (React + Canvas)                               │
│  — только отображение, input → PlayAction, poll/WS transport│
└───────────────────────────┬─────────────────────────────────┘
                            │ RoomTransport v2 (cursor, delta)
┌───────────────────────────▼─────────────────────────────────┐
│  Room API (Next route / future Worker)                      │
│  — lock, seat lifecycle, revision, troopJournal, trim       │
│  — НЕ содержит правил боя                                   │
└───────────────────────────┬─────────────────────────────────┘
                            │ applyPlay + tick loop
┌───────────────────────────▼─────────────────────────────────┐
│  Sim Core (pure TS, no React/DOM/fetch)                       │
│  — Game state, tick, validators, bot policy hooks            │
└───────────────────────────┬─────────────────────────────────┘
                            │ serialize
┌───────────────────────────▼─────────────────────────────────┐
│  Persistence (Redis / DO storage)                           │
│  — один blob комнаты + опционально compact snapshots        │
└─────────────────────────────────────────────────────────────┘

        Optional: AI Gateway (DeepSeek) — только генерация текста/JSON
        decrees; sim принимает уже validated Decree.
```

**Принцип:** Room API = orchestration; Sim = единственный источник правил.

### 3.1 Целевые модули (рефакторинг без big bang)

| Модуль | Сейчас | Цель |
|--------|--------|------|
| `sim/core` | `tower-game.ts` | `types`, `tick`, `actions`, чистые helpers |
| `sim/economy` | inline | income, wallets, mines, upgrades |
| `sim/combat` | inline | capture, cannon, troop movement |
| `sim/meta` | `match-meta`, часть tick | seed, mutators, objectives |
| `sim/chaos` | `chaos-rules` + applyDecree | registry эффектов |
| `sim/bots` | конец `tick` | `botPolicy(game, team): PlayAction[]` |
| `room/*` | без изменений идеи | protocol, store, seat |
| `client/*` | page.tsx | `useRoom`, `BattleView`, `Lobby`, hooks |

---

## 4. Контракт Sim Core

### 4.1 Публичный API (целевой)

```ts
// Псевдо-интерфейс — ориентир для Phase 1
type SimConfig = {
  seed: number;
  mutator: MatchMutator;
  bannedChaos: ChaosEffectKind[];
  troopRules: TroopRules;   // из troops-and-economy-spec
  economyRules: EconomyRules;
};

function createInitialGame(config: SimConfig): Game;
function tick(game: Game, dt: number, rng: Rng): Game;
function applyAction(game: Game, actor: Team, action: PlayAction): Game;
function validateAction(game: Game, actor: Team, action: PlayAction): boolean;
```

### 4.2 Инварианты

1. **Без React/DOM/fetch/Date.now** внутри sim — время только через `game.age` / переданный `now` в room layer.
2. **Детерминизм (мягкий → жёсткий):** Phase 0 — фиксированный `dt` steps (0.05) как сейчас; Phase 1 — injectable `Rng(seed)` для decree/bot/chaos instant; Phase 2 — golden tests «seed + action log → hash state».
3. **Иммутабельность actions:** `applyPlay` уже pure; `tick` мутирует towers in-place — **долгосрочно** перейти на structural sharing или документировать «tick mutates, clone at room boundary» (сейчас clone через spread на верхнем уровне не везде).
4. **Единая точка входа ботов:** не размазывать по `tick`; вызывать `runBotTurn` раз в N сек sim-time.
5. **Human teams:** `g.humans` задаётся room при старте; sim не знает про `playerId`.

### 4.3 Версионирование состояния

- Добавить `game.schemaVersion: number` (начать с `1`).
- При изменении troop wire — bump `ROOM_PROTOCOL_VERSION` или расширить `TroopWire` с optional tail (protocol v2 уже в проде — только backward-compatible additions).

---

## 5. Система войск (кратко)

Полная спецификация: [troops-and-economy-spec.md](./troops-and-economy-spec.md).

**Сейчас:** `strength` = боевые очки; `elite` от specialty; `variant` ≈ скорость + спрайт; `cargo`/`haul`/`scoutUntil` — отдельные режимы.

**Цель:** явные **роли** (разведчик, линия, тяжёлый, рейдер) с таблицей статов; рендер = `variant` id; sim = stats; боты выбирают variant по эвристике маршрута; сеть — поле `variant` уже в `TroopWire`, при смене статов — чаще `u` ops (контроль размера delta).

---

## 6. Экономика (кратко)

**Сейчас:**

- Старт: wallet 60/40 всем (`initialGame`).
- HQ: пассив в wallet.
- Gold/lumber: добыча в stock → caravan в HQ.
- Barracks/forts: `production()` → рост `count` (рекрут garrison).
- Upgrades/specialty/cannon из wallet.
- События: deposit ×3, fortress, caravan 150 gold.
- Победа по времени: `economicLeader` по `earned`.

**Целевые правила (продукт):**

1. **Шахты и лесопилки не рекрутируют** — только ресурсный контур (stock + caravan или упрощённый direct wallet — см. spec).
2. **Симметрия:** одинаковые стартовые wallet, зеркальная расстановка нейтралов, mutator применяется ко **всем** `speed`/`growth` (уже так для mutator march).
3. **Именование:** `Team` id (`you|red|purple|green`) ≠ display name; UI всегда `playerName(g, team)` / выбранный слот; убрать default HUD «я = you» до join.
4. **Прозрачность:** один экран «откуда доход» (HQ / mine / event / decree).

---

## 7. Стабильность мультиплеера

### 7.1 Lock & room_busy

- Сохранить `withLock` + retry на клиенте (exponential backoff, jitter).
- Рассмотреть **увеличение** `LOCK_PX` или отдельный «read-only advance» path: GET без записи если только poll (спорно — сейчас GET всегда `editRoom` → tick). **Phase 0:** документировать; **Phase 0.5:** optional `?observe=1` без advance для spectators (если нужно).
- POST action: возвращать transport сразу (уже так) — клиент не ждёт следующий poll.

### 7.2 Cursor & delta

- Клиент хранит `cursor` + `revision`; при `needsFullBootstrapRetry` — full без cursor.
- Сервер: `troopJournal.from === previousRevision` обязателен для troop delta (уже).
- **Тест-стратегия:** расширить suite: N параллельных poll, out-of-order cursor, reload mid-match, cap JSON trim не ломает towers id.

### 7.3 Seat lifecycle

| Событие | Поведение (целевое) |
|---------|---------------------|
| Join | UUID `playerId`, team unique, не started |
| Poll/command | `seen = now` |
| Reload | POST join с тем же `playerId` → resume seat |
| Away 20s | UI badge only |
| Silent 180s | release seat; mid-game → bot slot или vacancy (сейчас удаление из `humans`) |
| Match end | reset по op reset |

**Phase 0 fixes (малые):** не сбрасывать seat на transient `room_busy`; чёткие коды ошибок клиенту; idempotent join.

### 7.4 Производительность

- Лимит визуальных troops (`visualCount` ≤ 24) уже режет spawn visuals; sim strength aggregated — OK.
- Мониторинг: log `payloadBytes(full)`, p95 Redis size, revision rate.
- При росте: periodic full snapshot в отдельный key (Phase 2+) — не сейчас.

---

## 8. Хаос и приказы

### 8.1 Текущая модель

- **Legacy** numeric decrees (gold, freeze, …) + **chaos** timed rules + instant map ops.
- Бан до 2 chaos kinds на человека (`chaosBans`).
- DeepSeek генерирует JSON → `sanitizeDecreeCandidates`.

### 8.2 Рекомендация: не выкидывать, а **сжать**

1. **Plugin registry** (Phase 1–2):

```ts
type ChaosEffect = {
  kind: ChaosEffectKind;
  phase: 'instant' | 'rule';
  applyInstant?(g: Game, ctx: EffectCtx): Game;
  modifiers?: Partial<Record<'speed'|'growth'|'income'|…, ModifierFn>>;
};
```

2. **Сократить surface для игрока:** 26 → **12–15** в UI (объединить близкие: crawl/retreat → один «enemy slow» tier).
3. **Ranked / fair mode (config):** отключить map mutation + instant land flip + mine birth garrison; оставить timed buffs.
4. **AI optional:** только flavor + выбор из whitelist; sim валидирует (`validPlayerDecree`).

### 8.3 Decree chaos complexity

- Вынести `applyDecree` / `applyChaosInstant` из monolith в registry — **снижает** риск при economy refactor.
- Epoch objective / chronicle — meta layer; можно отложить UX (Phase 2).

---

## 9. Дорожная карта (фазы)

Оценки: **S** ≤3 дня, **M** ~1–2 нед, **L** 3+ нед (1 dev, без QA-отдела).

### Phase 0 — Стабилизация (S–M)

| Задача | Размер |
|--------|--------|
| Client retry `room_busy`, bootstrap timeout, не терять `playerId` | S |
| Тесты: parallel poll, reload resume, busy GET | S |
| Логирование revision + transport type | S |
| Документировать seat/away для support | S |
| Разрезать `page.tsx`: `useRoomTransport`, `LobbyPanel`, `MatchHud` (без смены sim) | M |

**Критерий готовности:** reload сохраняет место в 95% случаев; нет «ложного синего» в HUD после join другого цвета.

### Phase 1 — Economy + troops refactor (M–L)

| Задача | Размер |
|--------|--------|
| `EconomyRules` + mines ≠ recruit (spec) | M |
| `TroopRules` + stats по ролям; боты используют роли | M |
| Extract `sim/*` из `tower-game.ts` (re-export для compat) | M |
| Chaos registry, merge instant paths | M |
| Golden tests tick + applyPlay | S–M |
| UI: income breakdown, team labels | S |

**Критерий:** симметричный старт; шахта только ресурс; 4 роли ощутимы в бою.

### Phase 2 — UX & meta (M)

| Задача | Размер |
|--------|--------|
| Fair mode toggle (lobby) | M |
| Decree UI simplification | M |
| Replay uses sim package only | S |
| Perf: observe mode / snapshot policy | M |

### Phase 3 — Optional DO / WebSocket (L)

По [cloudflare-room-migration.md](./cloudflare-room-migration.md): Worker, тот же sim + protocol semantics; Redis fallback до cutover.

**Не блокирует** Phase 0–1.

---

## 10. Чего НЕ делать

1. **Микросервисы** sim отдельно от room — overhead для одного зала.
2. **Полный rewrite** на другой движок до стабилизации seat/delta.
3. **Удаление Redis** до готовности DO + soak tests.
4. **26 новых troop types** — достаточно 4–5 ролей с контрпиками soft.
5. **WebSocket-first** без сохранения HTTP fallback.
6. **Неконтrolled AI decrees** без whitelist/validate в sim.
7. **Раздувание `Game`** новыми optional полями без schemaVersion.

---

## 11. Операторский чеклист (Vercel)

1. Upstash: пара `UPSTASH_REDIS_REST_URL` + `TOKEN` (или STORAGE_*).
2. При жалobах «комната занята» — норма при пике; клиент должен retry; если постоянно — проверить cold starts / lock timeout.
3. `MAX_ROOM_CHARS` — при trim проверять целостность match (тест capJson).
4. DeepSeek — только decree route; ключ не обязателен для core gameplay.
5. Rollback: держать Redis при эксперименте с WS URL.

---

## 12. Метрики успеха v2

- Seat restore после F5 в активном лобби/матче.
- Delta трафик < full при steady state (troop `m` ops dominate).
- Бот-команда без wallet advantage (тест уже есть — не регрессировать).
- Игрок понимает доход и тип войск без wiki.
- Fair mode: карта без asymmetric mutation (optional).

---

## Приложение A — карта файлов

| Файл | Роль |
|------|------|
| `lib/tower-game.ts` | Sim monolith |
| `lib/play.ts` | Action adapter |
| `lib/room.ts` | Room FSM + revision |
| `lib/room-protocol.ts` | Transport v2 |
| `lib/room-store.ts` | Redis lock |
| `lib/chaos-rules.ts` | Timed chaos modifiers |
| `lib/decrees.ts` | Decree DSL + AI sanitize |
| `lib/match-meta.ts` | Seed, variants, bootstrap |
| `app/page.tsx` | Client god component |
| `app/api/room/route.ts` | HTTP API |
| `lib/live-view.ts` | React render stamping |

---

*Документ плановый; реализация — по фазам выше.*
