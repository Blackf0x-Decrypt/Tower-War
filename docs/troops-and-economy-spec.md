# Спецификация: войска и экономика (v2 target)

Дополнение к [architecture-v2-plan.md](./architecture-v2-plan.md).  
Описывает **целевое** поведение; текущий код — baseline для миграции.

---

## 1. Терминология

| Термин | Значение |
|--------|----------|
| **Team id** | `you` \| `red` \| `purple` \| `green` — ключ в sim и протоколе. |
| **Display color** | «Синий», «Красный», … — только UI; `you` historically «Синий», но игрок может занять любой слот. |
| **Garrison (`count`)** | Число защитников в башне; отправка army уменьшает count, создаёт troops со `strength`. |
| **Wallet** | `gold`, `resources`, `earned` — мета-экономика для апгрейдов и tie-break. |

**Правило UI:** после join все подписи «ваша команда» через `seat.team`, никогда не hardcode `you`.

---

## 2. Экономика — целевая модель

### 2.1 Ресурсы

- **Золото** — апгрейды, пушки, часть specialty.
- **Древесина (resources)** — апгрейды, пушки.
- **Earned** — интеграл ценности для победы по таймеру (как сейчас); не тратится напрямую.

### 2.2 Источники дохода (симметрично для всех team)

| Источник | Механика (target) | Сейчас |
|----------|-------------------|--------|
| **HQ (home)** | Медленный passive в wallet: gold/resources per sec | ✅ `income(t)` + wallet |
| **Gold mine** | Только **ресурсный** поток; **не** `production()` garrison | ✅ stock + caravan; ⚠ chaos `mine_birth` добавляет count |
| **Lumber** | То же для wood | ✅ |
| **Barracks** | **Единственный** нейтральный/захваченный объект с `production()` → count | ✅ |
| **Forts (tower)** | Только garrison через production? **Target:** forts — defense + cannon, рост count только HQ + barracks | ⚠ forts имеют production 0 except specialty |
| **Events** | deposit, caravan, fortress — global, symmetric rules | ✅ |
| **Decrees** | Explicit wallet/tower deltas | legacy + chaos |

### 2.3 Шахты не рекрутируют (hard requirement)

**Запрещено для `kind ∈ {gold, lumber}`:**

- `production()` > 0 для garrison.
- Decree/chaos, добавляющий `count` на mine/lumber (переназначить `chaos_mine_birth` только на barracks/tower или fair mode off).

**Разрешено:**

- Увеличение добычи (stock rate, caravan size, deposit event).
- Захват mine → control worker count via **existing** garrison sent by player (not auto-recruit).

### 2.4 Контур доставки ресурсов

**Вариант A (минимальная миграция):** оставить stock + caravan (как сейчас), UI показывает «на шахте / в пути / в казне».

**Вариант B (упрощение, Phase 1 optional):** mine income напрямую в wallet с penalty 15% vs caravan — меньше troops-clutter, проще для новичков.

**Рекомендация:** Phase 1 = A + UI; B — флаг `EconomyRules.directMineWallet`.

### 2.5 Старт и симметрия

- Wallet: одинаковые `gold/resources` (60/40).
- Карта: зеркалирование квадрантов (сохранить).
- **Fair mode:** отключить `applyMapMutation` и instant chaos flip/shuffle; mutator march — ко всем командам (уже).
- Bot slots: без стартового grant (тест `bots act without resource advantage` — guard).

### 2.6 Расходы

| Действие | Стоимость |
|----------|-----------|
| Upgrade tower | `50*level` gold, `30*level` wood |
| Cannon level | `40*level` gold, `25*level` wood |
| Scout | wallet (как сейчас) |
| Specialty | one-time (как сейчас) |

Балансировка — таблица в config (`EconomyRules`), не magic numbers в теле tick.

---

## 3. Войска — целевая модель

### 3.1 Данные (sim)

```ts
type TroopRole = 'line' | 'heavy' | 'scout' | 'skirm'; // wire: variant

type TroopRules = {
  roles: Record<TroopRole, {
    speedMult: number;
    strengthMult: number;      // per dispatched unit
    cannonExposureMult: number;
    captureMult: number;
    icon: string;              // client-only hint
  }>;
  dispatchVisualCap: number;   // 24
  eliteStrengthMult: number;   // specialty elite
};
```

### 3.2 Предлагаемые статы (начальный баланс, soft counters)

| Role | Speed | Strength | Capture | Cannon vuln | Роль |
|------|-------|----------|---------|-------------|------|
| **line** | 1.0 | 1.0 | 1.0 | 1.0 | default |
| **heavy** | 0.88 | 1.35 | 1.15 | 0.85 | siege, держит точку |
| **scout** | 1.12 | 0.65 | 0.9 | 1.2 | разведка, быстрый захват слабых |
| **skirm** | 1.05 | 0.9 | 1.0 | 1.0 | vs cannon kiting (slight speed) |

**Soft counter loop (не RPS жёсткий):** heavy vs fortified; scout vs isolated neutrals; line — универсал; skirm — flanking bonus vs retreating (optional Phase 2).

### 3.3 Откуда берётся role при dispatch

1. **Источник:** barracks bias (уже partial в `troopVariantFor`).
2. **Маршрут:** assault neutral → scout/skirm; assault player fort → heavy; supply → line.
3. **Игрок (Phase 2):** optional stance slider «быстро / тяжело» → fraction split по roles.

Функция:

```ts
function pickTroopRole(ctx: DispatchCtx): TroopRole;
```

Заменяет чистый hash roll в `troopVariantFor`.

### 3.4 Рендер vs sim

- Canvas `TroopLayer` уже мапит team hue + variant sprite.
- Sim меняет только stats + `variant` field.
- **Wire:** `TroopWire` включает variant через full spawn/update; motion deltas `m` не трогают variant — OK.

### 3.5 Боты

`botPolicy` при dispatch:

- neutral gold/lumber → scout line if `workers` low else heavy.
- enemy fort → heavy if wallet allows upgrades else line.
- не получать extra strength multiplier по сравнению с human (same `dispatch()`).

### 3.6 Сеть и delta

- Spawn: `s` op с полным wire.
- Role change mid-route: rare → `u` op.
- Массовый spawn: cap visuals 24, strength = total army (unchanged).

**Regression guard:** existing tests on `diffTroops` / payload size remain green.

---

## 4. Миграция с текущего кода

| Шаг | Действие |
|-----|----------|
| 1 | Ввести `TroopRules` / `EconomyRules` const рядом с `match-meta` |
| 2 | `variantSpeedMult` → generic `roleMult(role, stat)` |
| 3 | `production(t)`: assert `gold/lumber` → 0 |
| 4 | `chaos_mine_birth`: filter kinds or fair mode |
| 5 | UI copy: mine capture notice без «набирает бойцов» |
| 6 | `page.tsx`: HUD income by source |

---

## 5. Acceptance criteria

1. Захват gold mine не увеличивает auto `count` без barracks/HQ production.
2. Две human команды с одинаковым AFK имеют одинаковый income rate при одинаковых владениях.
3. Heavy vs line measurably differs in time-to-capture neutral (unit test on isolated scenario).
4. Troop delta size p95 не хуже текущего на 1000 troops bench (`tick-bench`).

---

*Версия 1.0 — planning only.*
