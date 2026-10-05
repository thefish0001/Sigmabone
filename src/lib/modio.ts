/* mod.io deprecated api.mod.io in 2025 — per-game hosts on modapi.io are
   the current API path (BONELAB = game 38) */
const API_ROOT = 'https://g-38.modapi.io/v1';
export const GAME_NAME_ID = 'bonelab';

/* When deployed on Cloudflare Pages, /api/modio is a server-keyed proxy —
   visitors need no API key. Detected once via probeServerKey(). */
let serverBase: string | null = null;
export const serverKeyed = () => serverBase !== null;

export async function probeServerKey(): Promise<boolean> {
  try {
    const r = await fetch('/api/modio/games?name_id=bonelab&_limit=1', {
      headers: { 'X-Modio-Platform': 'windows' },
    });
    // must actually be mod.io JSON — a static host's SPA fallback would
    // return 200 index.html here
    const body = (await r.json().catch(() => null)) as {
      data?: unknown;
    } | null;
    if (r.ok && Array.isArray(body?.data)) {
      serverBase = '/api/modio';
      return true;
    }
  } catch {
    /* not on a Workers deployment */
  }
  return false;
}

export interface ModioPaged<T> {
  data: T[];
  result_count: number;
  result_total: number;
}

export interface ModioLogo {
  filename: string;
  original: string;
  thumb_320x180: string;
  thumb_640x360: string;
}

export interface ModioFile {
  id: number;
  mod_id: number;
  filename: string;
  version: string;
  filesize: number;
  filesize_uncompressed: number;
  filehash: { md5: string };
  download: { binary_url: string; date_expires: number };
  platforms?: { platform: string; status: number }[];
}

export interface ModioMod {
  id: number;
  game_id: number;
  name: string;
  name_id: string;
  summary: string;
  profile_url: string;
  logo: ModioLogo;
  date_added: number;
  date_updated: number;
  modfile?: ModioFile;
  stats?: {
    downloads_total: number;
    subscribers_total: number;
    popularity_rank_position: number;
  };
  tags?: { name: string }[];
  submitted_by?: { username: string; name_id: string };
}

export interface ModioGame {
  id: number;
  name: string;
  name_id: string;
}

export class ModioError extends Error {
  status: number;
  code: number;
  constructor(status: number, code: number, message: string) {
    super(message);
    this.name = 'ModioError';
    this.status = status;
    this.code = code;
  }
  get unauthorized() {
    return this.status === 401 || this.status === 403;
  }
  get rateLimited() {
    return this.status === 429;
  }
}

async function request<T>(
  apiKey: string,
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const url = new URL((serverBase ?? API_ROOT) + path, location.origin);
  if (!serverBase) url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { 'X-Modio-Platform': 'windows' } });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-json body */
  }
  if (!res.ok) {
    const e = body?.error;
    throw new ModioError(
      res.status,
      e?.code ?? 0,
      e?.message ?? `mod.io request failed (${res.status})`,
    );
  }
  return body as T;
}

export async function resolveGameId(apiKey: string): Promise<number> {
  const r = await request<ModioPaged<ModioGame>>(apiKey, '/games', {
    name_id: GAME_NAME_ID,
    _limit: 1,
  });
  if (!r.data.length)
    throw new ModioError(404, 0, `Game '${GAME_NAME_ID}' not found on mod.io`);
  return r.data[0].id;
}

export async function searchMods(
  apiKey: string,
  gameId: number,
  q: string,
  limit = 24,
): Promise<ModioMod[]> {
  const r = await request<ModioPaged<ModioMod>>(apiKey, `/games/${gameId}/mods`, {
    _q: q,
    _limit: limit,
  });
  return r.data;
}

export async function getModsByIds(
  apiKey: string,
  gameId: number,
  ids: number[],
): Promise<ModioMod[]> {
  if (!ids.length) return [];
  const r = await request<ModioPaged<ModioMod>>(
    apiKey,
    `/games/${gameId}/mods`,
    { 'id-in': ids.join(','), _limit: 100 },
  );
  return r.data;
}

export async function getModBySlug(
  apiKey: string,
  gameId: number,
  slug: string,
): Promise<ModioMod | null> {
  const r = await request<ModioPaged<ModioMod>>(apiKey, `/games/${gameId}/mods`, {
    name_id: slug,
    _limit: 1,
  });
  return r.data[0] ?? null;
}

export async function getMod(
  apiKey: string,
  gameId: number,
  id: number,
): Promise<ModioMod> {
  return request<ModioMod>(apiKey, `/games/${gameId}/mods/${id}`);
}

export function fmtBytes(n: number): string {
  if (!n || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}
