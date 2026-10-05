import type { ModioMod } from './modio';
import type { ScanResult } from './fs';
import type { TsPackage } from './thunderstore';
import { latest } from './thunderstore';

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export type InstallStatus = 'installed' | 'likely' | 'missing' | 'unavailable';

export interface ModStatus {
  status: InstallStatus;
  via: 'manifest' | 'manual' | 'folder' | null;
  /** folder/file name that produced the match */
  folder?: string;
}

export function statusFor(mod: ModioMod, scan: ScanResult | null): ModStatus {
  if (!mod.modfile) return { status: 'unavailable', via: null };
  if (!scan) return { status: 'missing', via: null };

  const hit = scan.manifest.mods.find((m) => m.id === mod.id);
  if (hit && scan.names.some((n) => norm(n) === norm(hit.folder)))
    return { status: 'installed', via: 'manifest', folder: hit.folder };
  if (scan.manifest.manual.includes(mod.id))
    return { status: 'installed', via: 'manual' };

  const candidates = [norm(mod.name_id), norm(mod.name)].filter(
    (s) => s.length >= 4,
  );
  for (const folder of scan.names) {
    const nf = norm(folder);
    const match = candidates.some(
      (c) =>
        nf === c ||
        (c.length >= 6 && nf.includes(c)) ||
        (nf.length >= 6 && c.includes(nf)),
    );
    if (match) return { status: 'likely', via: 'folder', folder };
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
  const candidates = [norm(pkg.name), norm(pkg.full_name)].filter(
    (s) => s.length >= 4,
  );
  for (const entry of [...scan.names, ...scan.files]) {
    const ne = norm(entry.replace(/\.(dll|xml|json|zip)$/i, ''));
    if (!ne) continue;
    const match = candidates.some(
      (c) =>
        ne === c ||
        (c.length >= 6 && ne.includes(c)) ||
        (ne.length >= 6 && c.includes(ne)),
    );
    if (match) return { status: 'likely', via: 'folder', folder: entry };
  }
  return { status: 'missing', via: null };
}
