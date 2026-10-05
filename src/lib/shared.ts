import type { Collection } from './collection';

/* The group's shared collection lives in Workers KV behind /api/collection.
   Returns null when the binding isn't configured (static hosts etc). */

export async function getShared(): Promise<Collection | null> {
  try {
    const r = await fetch('/api/collection');
    if (!r.ok) return null;
    const c = (await r.json()) as Partial<Collection> | null;
    if (!c || !Array.isArray(c.m) || !Array.isArray(c.t)) return null;
    return {
      v: 2,
      n: typeof c.n === 'string' ? c.n : 'Shared collection',
      m: c.m.filter((e) => e && typeof e.i === 'number'),
      t: c.t.filter((s) => typeof s === 'string'),
    };
  } catch {
    return null;
  }
}

export async function putShared(c: Collection): Promise<boolean> {
  try {
    const r = await fetch('/api/collection', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(c),
    });
    return r.ok;
  } catch {
    return false;
  }
}
