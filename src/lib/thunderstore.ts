/* Thunderstore client — code mods (MelonLoader) for BONELAB.
   The community package index is one ~2MB JSON; fetched once and cached. */

const INDEX_URL = 'https://thunderstore.io/c/bonelab/api/v1/package/';

export interface TsVersion {
  name: string;
  full_name: string;
  description: string;
  icon: string;
  version_number: string;
  dependencies: string[];
  download_url: string;
  downloads: number;
  date_created: string;
  website_url: string;
  is_active: boolean;
  file_size: number;
  uuid4: string;
}

export interface TsPackage {
  name: string;
  full_name: string; // "owner-name" — stable collection ref
  owner: string;
  package_url: string;
  rating_score: number;
  is_pinned: boolean;
  is_deprecated: boolean;
  has_nsfw_content: boolean;
  categories: string[];
  date_updated: string;
  versions: TsVersion[];
}

let cache: Promise<TsPackage[]> | null = null;

export function getPackages(): Promise<TsPackage[]> {
  if (!cache) {
    cache = fetch(INDEX_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Thunderstore index failed (${r.status})`);
        return r.json() as Promise<TsPackage[]>;
      })
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

export const latest = (p: TsPackage): TsVersion | undefined =>
  p.versions.find((v) => v.is_active) ?? p.versions[0];

export function searchPackages(
  all: TsPackage[],
  q: string,
  limit = 24,
): TsPackage[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const scored = all
    .filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.owner.toLowerCase().includes(needle) ||
        p.full_name.toLowerCase().includes(needle) ||
        p.categories.some((c) => c.toLowerCase().includes(needle)),
    )
    .sort(
      (a, b) =>
        (latest(b)?.downloads ?? 0) - (latest(a)?.downloads ?? 0) ||
        b.rating_score - a.rating_score,
    );
  return scored.slice(0, limit);
}

export const byRef = (all: TsPackage[], ref: string) =>
  all.find((p) => p.full_name === ref || p.full_name.toLowerCase() === ref.toLowerCase());

/** "owner-name-1.2.3" → "owner-name" */
export const depRef = (dep: string) => dep.replace(/-\d+(\.\d+)*(-[\w.]+)?$/, '');

/** thunderstore.io/c/bonelab/p/{owner}/{name}/… → "owner-name" */
export function parseTsUrl(input: string): string | null {
  const m = input
    .trim()
    .match(/thunderstore\.io\/c\/[\w-]+\/p\/([\w-]+)\/([\w-]+)/i);
  return m ? `${m[1]}-${m[2]}` : null;
}

export const isLoaderRef = (ref: string) =>
  /^(LavaGang-MelonLoader|.*melonloader.*)$/i.test(ref);
