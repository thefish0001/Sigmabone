import type { ModioMod } from './modio';
import type { ScanResult } from './fs';
import type { TsPackage } from './thunderstore';
import { latest } from './thunderstore';

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export type InstallStatus = 'installed' | 'missing' | 'unavailable';

export interface ModStatus {
  status: InstallStatus;
  via: 'manifest' | 'manual' | 'folder' | null;
  /** folder/file name that produced the match */
  folder?: string;
}

/* ---------- tokenized fuzzy matching ----------
   BONELAB folders look like `BaBaCorp.MiscExplosiveDevices` while mod.io
   gives `miscellaneous-explosive-devices` / "Miscellaneous Explosive
   Devices". Substring matching alone misses these, so we compare token
   sets with prefix tolerance (misc → miscellaneous). */

const camel = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

const tokens = (s: string): string[] =>
  camel(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);

/** tokens are "the same" when equal or one prefixes the other */
const tokHit = (a: string, b: string) =>
  a === b || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b));

/** how many `needles` appear in `hay` (count + fraction) */
function overlap(needles: string[], hay: string[]): { n: number; f: number } {
  if (!needles.length) return { n: 0, f: 0 };
  const n = needles.filter((t) => hay.some((h) => tokHit(t, h))).length;
  return { n, f: n / needles.length };
}

/** candidate keys for one on-disk name: whole, minus `Author.` prefix, last segment */
const nameKeys = (name: string): string[] => {
  const segs = name.split(/[._-]+/).filter(Boolean);
  return [
    name,
    segs.length > 1 ? segs.slice(1).join('') : '',
    segs[segs.length - 1] ?? '',
  ]
    .map(norm)
    .filter((s) => s.length >= 4);
};

const contains = (a: string, b: string) =>
  a === b || (b.length >= 6 && a.includes(b)) || (a.length >= 6 && b.includes(a));

function fuzzyHit(
  name: string,
  keys: string[],
  needleSets: string[][],
): boolean {
  const k = nameKeys(name);
  if (k.some((x) => keys.some((c) => contains(x, c)))) return true;
  const hay = [...new Set(name.split(/[._-]+/).flatMap(tokens))];
  // score each source independently — an author token in the zip name
  // shouldn't dilute a clean name match
  return needleSets.some((set) => {
    const { n, f } = overlap(set, hay);
    return n >= 2 && f >= 0.66;
  });
}

export function statusFor(mod: ModioMod, scan: ScanResult | null): ModStatus {
  if (!mod.modfile) return { status: 'unavailable', via: null };
  if (!scan) return { status: 'missing', via: null };

  const hit = scan.manifest.mods.find((m) => m.id === mod.id);
  if (hit && scan.names.some((n) => norm(n) === norm(hit.folder)))
    return { status: 'installed', via: 'manifest', folder: hit.folder };
  if (scan.manifest.manual.includes(mod.id))
    return { status: 'installed', via: 'manual' };

  // candidates: slug, display name, and the zip filename (often Author.Name)
  const zipStem = mod.modfile.filename?.replace(/\.zip$/i, '') ?? '';
  const keys = [mod.name_id, mod.name, zipStem]
    .map(norm)
    .filter((s) => s.length >= 4);
  const needles = [mod.name_id, mod.name, zipStem]
    .map(tokens)
    .filter((t) => t.length);

  for (const folder of scan.names) {
    if (fuzzyHit(folder, keys, needles))
      return { status: 'installed', via: 'folder', folder };
  }
  return { status: 'missing', via: null };
}

export function statusForPkg(
  pkg: TsPackage,
  scan: ScanResult | null,
): ModStatus {
  if (!latest(pkg)) return { status: 'unavailable', via: null };
  if (!scan) return { status: 'missing', via: null };

  const hit = scan.manifest.pkgs.find((p) => p.ref === pkg.full_name);
  if (hit) return { status: 'installed', via: 'manifest', folder: hit.ver };
  if (scan.manifest.manualPkgs.includes(pkg.full_name))
    return { status: 'installed', via: 'manual' };

  // fuzzy: a dll or folder resembling the package name inside Mods/
  const keys = [pkg.name, pkg.full_name]
    .map(norm)
    .filter((s) => s.length >= 4);
  const needles = [pkg.name, pkg.full_name]
    .map(tokens)
    .filter((t) => t.length);

  for (const entry of [...scan.names, ...scan.files]) {
    // nested scan entries are "dir/file" — the dll name is what matters;
    // mod managers also disable mods by appending .disabled
    const stem = (entry.split('/').pop() ?? entry).replace(
      /\.(dll|xml|json|zip|disabled)+$/i,
      '',
    );
    if (fuzzyHit(stem, keys, needles))
      return { status: 'installed', via: 'folder', folder: entry };
  }
  return { status: 'missing', via: null };
}
