import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

/** mod.io entry: mod id + optional pinned file id */
export interface CollectionMod {
  i: number;
  f?: number;
}

/**
 * v2 collection format:
 *   m — mod.io (SDK) mods, installed into LocalLow/…/BONELAB/Mods
 *   t — thunderstore (code) mods as "owner-name" refs, installed into the
 *       game folder's Mods dir
 * v1 links (m only) decode fine — `t` defaults to empty.
 */
export interface Collection {
  v: number;
  n: string;
  m: CollectionMod[];
  t: string[];
}

const toB64Url = (u8: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const fromB64Url = (s: string): Uint8Array => {
  const b64 = s
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};

export function encodeCollection(c: Collection): string {
  return toB64Url(deflateSync(strToU8(JSON.stringify(c)), { level: 9 }));
}

export function decodeCollection(s: string): Collection {
  const u8 = inflateSync(fromB64Url(s));
  const c = JSON.parse(strFromU8(u8)) as Collection;
  if (!c || typeof c !== 'object' || !Array.isArray(c.m))
    throw new Error('Invalid collection data');
  if (typeof c.n !== 'string') c.n = '';
  c.m = c.m.filter((e) => e && typeof e.i === 'number');
  c.t = Array.isArray(c.t) ? c.t.filter((e) => typeof e === 'string') : [];
  return c;
}

export function shareUrl(c: Collection): string {
  return `${location.origin}${location.pathname}#c=${encodeCollection(c)}`;
}

export function parseShareLink(input: string): Collection | null {
  const m = input.match(/#c=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    return decodeCollection(m[1]);
  } catch {
    return null;
  }
}

export type ModRef = { kind: 'id'; id: number } | { kind: 'slug'; slug: string };

/** Parse a pasted mod.io page URL, or a bare numeric mod id. */
export function parseModRef(input: string): ModRef | null {
  const t = input.trim();
  const url = t.match(/mod\.io\/g\/[\w-]+\/m\/([\w-]+)/i);
  if (url) return { kind: 'slug', slug: url[1] };
  if (/^\d{3,}$/.test(t)) return { kind: 'id', id: Number(t) };
  return null;
}
