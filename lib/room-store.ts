// Shared room persistence. Redis on Vercel, in-memory when developing locally.
// Every read-modify-write takes a short SET NX PX lock so two polls cannot
// advance the same clock twice.

export const ROOM_KEY = 'tower-war:room';
export const LOCK_KEY = 'tower-war:room:lock';

export const REDIS_MISSING_ERROR =
  'Общая комната не работает: на Vercel нет Upstash Redis. Подключите Storage к проекту и нажмите Redeploy. Подходят пары UPSTASH_REDIS_REST_URL/TOKEN, STORAGE_REDIS_REST_URL/TOKEN, STORAGE_UPSTASH_REDIS_REST_URL/TOKEN, STORAGE_URL/TOKEN или KV_REST_API_URL/TOKEN.';

/** First complete pair wins. Vercel Storage prefix STORAGE renames the defaults. */
export const REDIS_ENV_PAIRS = [
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['STORAGE_REDIS_REST_URL', 'STORAGE_REDIS_REST_TOKEN'],
  ['STORAGE_UPSTASH_REDIS_REST_URL', 'STORAGE_UPSTASH_REDIS_REST_TOKEN'],
  ['STORAGE_URL', 'STORAGE_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
] as const;

export function redisCredentials(): { url: string; token: string } | null {
  for (const [urlName, tokenName] of REDIS_ENV_PAIRS) {
    const url = process.env[urlName]?.trim();
    const token = process.env[tokenName]?.trim();
    if (url && token) return { url, token };
  }
  return null;
}

const LOCK_PX = 2000;
const LOCK_ATTEMPTS = 40;
const LOCK_WAIT_MS = 25;
const MAX_ROOM_CHARS = 480_000;

export class RoomBusyError extends Error {
  constructor() {
    super('Комната занята другим ходом. Повторите.');
    this.name = 'RoomBusyError';
  }
}

export type Kv = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  setNxPx(key: string, value: string, px: number): Promise<boolean>;
  compareDel(key: string, value: string): Promise<void>;
};

type Mem = {
  values: Map<string, string>;
  locks: Map<string, { token: string; until: number }>;
};

const globalState = globalThis as typeof globalThis & {
  __towerRoomKv?: Mem;
};

export function storeMode(): 'redis' | 'memory' | 'missing' {
  if (redisCredentials()) return 'redis';
  if (process.env.VERCEL === '1') return 'missing';
  return 'memory';
}

function memoryKv(mem: Mem): Kv {
  return {
    async get(key) {
      return mem.values.get(key) ?? null;
    },
    async set(key, value) {
      mem.values.set(key, value);
    },
    async setNxPx(key, value, px) {
      const now = Date.now();
      const held = mem.locks.get(key);
      if (held && held.until > now) return false;
      mem.locks.set(key, { token: value, until: now + px });
      return true;
    },
    async compareDel(key, value) {
      const held = mem.locks.get(key);
      if (held?.token === value) mem.locks.delete(key);
    },
  };
}

export function createMemoryKv(): Kv {
  return memoryKv({ values: new Map(), locks: new Map() });
}

export function sharedMemoryKv(): Kv {
  if (!globalState.__towerRoomKv) {
    globalState.__towerRoomKv = { values: new Map(), locks: new Map() };
  }
  return memoryKv(globalState.__towerRoomKv);
}

async function redisCall(command: (string | number)[]): Promise<unknown> {
  const creds = redisCredentials();
  if (!creds) throw new Error('redis env missing');
  const { url, token } = creds;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`redis http ${response.status}`);
  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) throw new Error('redis command failed');
  return payload.result ?? null;
}

export function createRedisKv(): Kv {
  return {
    async get(key) {
      const result = await redisCall(['GET', key]);
      if (typeof result === 'string') return result;
      if (result && typeof result === 'object') return JSON.stringify(result);
      return null;
    },
    async set(key, value) {
      const result = await redisCall(['SET', key, value]);
      if (result !== 'OK') throw new Error('redis set failed');
    },
    async setNxPx(key, value, px) {
      const result = await redisCall(['SET', key, value, 'NX', 'PX', String(px)]);
      return result === 'OK';
    },
    async compareDel(key, value) {
      await redisCall([
        'EVAL',
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        '1',
        key,
        value,
      ]);
    },
  };
}

let kvOverride: Kv | null = null;

export function setRoomKvForTests(kv: Kv | null) {
  kvOverride = kv;
}

export function resolveKv(): Kv | 'missing' {
  if (kvOverride) return kvOverride;
  const mode = storeMode();
  if (mode === 'missing') return 'missing';
  if (mode === 'redis') return createRedisKv();
  return sharedMemoryKv();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withLock<T>(kv: Kv, fn: () => Promise<T>): Promise<T> {
  const token = crypto.randomUUID();
  let held = false;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    held = await kv.setNxPx(LOCK_KEY, token, LOCK_PX);
    if (held) break;
    await sleep(LOCK_WAIT_MS);
  }
  if (!held) throw new RoomBusyError();
  try {
    return await fn();
  } finally {
    try {
      await kv.compareDel(LOCK_KEY, token);
    } catch {
      // The lock expires on its own. Do not hide the original result.
    }
  }
}

export async function lockedUpdate<T>(
  kv: Kv,
  key: string,
  fn: (raw: string | null) => { json: string; result: T } | Promise<{ json: string; result: T }>,
): Promise<T> {
  return withLock(kv, async () => {
    const raw = await kv.get(key);
    const next = await fn(raw);
    await kv.set(key, next.json);
    return next.result;
  });
}

export function capJson(json: string, trim: (parsed: unknown) => unknown): string {
  if (json.length <= MAX_ROOM_CHARS) return json;
  const trimmed = JSON.stringify(trim(JSON.parse(json)));
  return trimmed.length < json.length ? trimmed : json;
}

export { MAX_ROOM_CHARS };
