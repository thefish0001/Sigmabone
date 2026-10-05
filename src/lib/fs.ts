import { unzipSync } from 'fflate';
import type { ModioMod } from './modio';
import type { TsPackage } from './thunderstore';
import { latest } from './thunderstore';

/* Minimal File System Access typings — lib.dom coverage varies across TS
   versions, so we define our own narrow shape and cast at the boundary. */
export interface FileLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: Blob | ArrayBuffer | Uint8Array): Promise<void>;
    close(): Promise<void>;
  }>;
}

export interface DirLike {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileLike>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, DirLike | FileLike]>;
  queryPermission(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

/** 'sdk' → LocalLow/…/BONELAB/Mods · 'code' → game folder (or its Mods dir) */
export type FolderKind = 'sdk' | 'code';
/** 'root' = picked the BONELAB game dir · 'mods' = picked its Mods dir directly */
export type CodeMode = 'root' | 'mods';

export interface FolderSlot {
  kind: FolderKind;
  handle: DirLike;
  mode: CodeMode;
}

export const fsSupported = () =>
  typeof (window as any).showDirectoryPicker === 'function';

/* ---------- pick + classify ---------- */

export interface Classified {
  kind: FolderKind;
  mode: CodeMode;
  dlls: number;
  dirs: number;
}

/**
 * Sniff a picked directory and guess what it is:
 *  - contains .dll files, or is named "Mods" inside a game dir → code mods
 *  - named "BONELAB" or contains Mods/ + MelonLoader-adjacent dirs → game root
 *  - otherwise (mostly extracted mod folders) → SDK mods
 */
export async function classifyFolder(dir: DirLike): Promise<Classified> {
  let dirs = 0;
  let dlls = 0;
  let hasModsSubdir = false;
  let hasLoaderBits = false;
  for await (const [name, h] of dir.entries()) {
    const n = name.toLowerCase();
    if (h.kind === 'directory') {
      dirs++;
      if (n === 'mods') hasModsSubdir = true;
      if (n === 'plugins' || n === 'userdata' || n === 'melonloader')
        hasLoaderBits = true;
    } else if (n.endsWith('.dll')) dlls++;
  }
  const lname = dir.name.toLowerCase();
  if (lname === 'mods' || dlls > 0) {
    // a Mods folder full of dlls → code mods, aimed straight at the Mods dir
    if (lname === 'mods' && (dlls > 0 || dirs <= 2))
      return { kind: 'code', mode: 'mods', dlls, dirs };
    if (dlls > 0 && !hasModsSubdir)
      return { kind: 'code', mode: 'mods', dlls, dirs };
  }
  if (hasModsSubdir || hasLoaderBits || lname === 'bonelab')
    return { kind: 'code', mode: 'root', dlls, dirs };
  return { kind: 'sdk', mode: 'mods', dlls, dirs };
}

export async function pickFolder(): Promise<FolderSlot> {
  const handle = (await (window as any).showDirectoryPicker({
    mode: 'readwrite',
  })) as DirLike;
  const c = await classifyFolder(handle);
  const slot: FolderSlot = { kind: c.kind, handle, mode: c.mode };
  await saveHandle(slot);
  return slot;
}

export async function ensureWritable(dir: DirLike): Promise<boolean> {
  if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted')
    return true;
  return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Resolve the dir that actually receives .dll payloads. */
export async function modsDirOf(slot: FolderSlot): Promise<DirLike> {
  if (slot.kind === 'sdk' || slot.mode === 'mods') return slot.handle;
  return slot.handle.getDirectoryHandle('Mods', { create: true });
}

/* ---------- IndexedDB persistence ---------- */

const DB = 'sigmabone';
const STORE = 'kv';

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idbGet<T>(k: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction(STORE).objectStore(STORE).get(k);
    r.onsuccess = () => res(r.result as T);
    r.onerror = () => rej(r.error);
  });
}

async function idbSet(k: string, v: unknown): Promise<void> {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

interface StoredSlot {
  kind: FolderKind;
  mode: CodeMode;
  handle: DirLike;
}

export const saveHandle = (s: FolderSlot) =>
  idbSet(`dir.${s.kind}`, { kind: s.kind, mode: s.mode, handle: s.handle });

export async function loadHandle(
  kind: FolderKind,
): Promise<FolderSlot | null> {
  // current format
  const cur = await idbGet<StoredSlot>(`dir.${kind}`);
  if (cur?.handle) return { kind, handle: cur.handle, mode: cur.mode };
  // v1 stored a single untyped handle under 'modsDir' — adopt it as sdk
  if (kind === 'sdk') {
    const old = await idbGet<DirLike>('modsDir');
    if (old) return { kind, handle: old, mode: 'mods' };
  }
  return null;
}

export const forgetHandle = (kind: FolderKind) => idbSet(`dir.${kind}`, undefined);

/* ---------- manifests ---------- */

export interface ManifestMod {
  id: number;
  name_id: string;
  file: number;
  folder: string;
  md5?: string;
}

export interface ManifestPkg {
  ref: string; // "owner-name"
  ver: string;
  files: string[];
}

export interface Manifest {
  v: number;
  mods: ManifestMod[];
  pkgs: ManifestPkg[];
  manual: number[];
  manualPkgs: string[];
}

const MANIFEST_FILE = '.sigmabone.json';
const emptyManifest = (): Manifest => ({
  v: 1,
  mods: [],
  pkgs: [],
  manual: [],
  manualPkgs: [],
});

export interface ScanResult {
  /** top-level directory names (sdk: mod folders · code: subdirs of Mods) */
  names: string[];
  /** top-level file names (code: .dll payloads etc.) */
  files: string[];
  manifest: Manifest;
}

export async function scanDir(dir: DirLike): Promise<ScanResult> {
  const names: string[] = [];
  const files: string[] = [];
  let manifest = emptyManifest();
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'directory') names.push(name);
    else files.push(name);
  }
  try {
    const fh = await dir.getFileHandle(MANIFEST_FILE);
    const parsed = JSON.parse(await (await fh.getFile()).text());
    if (parsed && Array.isArray(parsed.mods)) {
      manifest = {
        v: 1,
        mods: parsed.mods,
        pkgs: Array.isArray(parsed.pkgs) ? parsed.pkgs : [],
        manual: Array.isArray(parsed.manual) ? parsed.manual : [],
        manualPkgs: Array.isArray(parsed.manualPkgs) ? parsed.manualPkgs : [],
      };
    }
  } catch {
    /* no manifest yet */
  }
  names.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.localeCompare(b));
  return { names, files, manifest };
}

/** Scan a slot: sdk scans its root, code scans its resolved Mods dir but
 *  reads/writes the manifest on the picked handle. */
export async function scanSlot(slot: FolderSlot): Promise<ScanResult> {
  const manifestDir = slot.handle;
  const listDir = await modsDirOf(slot).catch(() => slot.handle);
  const names: string[] = [];
  const files: string[] = [];
  let manifest = emptyManifest();
  for await (const [name, h] of listDir.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'directory') names.push(name);
    else files.push(name);
  }
  try {
    const fh = await manifestDir.getFileHandle(MANIFEST_FILE);
    const parsed = JSON.parse(await (await fh.getFile()).text());
    if (parsed && Array.isArray(parsed.mods)) {
      manifest = {
        v: 1,
        mods: parsed.mods,
        pkgs: Array.isArray(parsed.pkgs) ? parsed.pkgs : [],
        manual: Array.isArray(parsed.manual) ? parsed.manual : [],
        manualPkgs: Array.isArray(parsed.manualPkgs) ? parsed.manualPkgs : [],
      };
    }
  } catch {
    /* no manifest */
  }
  names.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.localeCompare(b));
  return { names, files, manifest };
}

async function writeManifest(dir: DirLike, m: Manifest): Promise<void> {
  const fh = await dir.getFileHandle(MANIFEST_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([JSON.stringify(m, null, 2)]));
  await w.close();
}

export async function markManual(
  slot: FolderSlot,
  scan: ScanResult,
  modId: number,
  installed: boolean,
): Promise<ScanResult> {
  const manifest: Manifest = {
    ...scan.manifest,
    manual: scan.manifest.manual.filter((i) => i !== modId),
  };
  if (installed) manifest.manual.push(modId);
  await writeManifest(slot.handle, manifest);
  return { ...scan, manifest };
}

export async function markManualPkg(
  slot: FolderSlot,
  scan: ScanResult,
  ref: string,
  installed: boolean,
): Promise<ScanResult> {
  const manifest: Manifest = {
    ...scan.manifest,
    manualPkgs: scan.manifest.manualPkgs.filter((r) => r !== ref),
  };
  if (installed) manifest.manualPkgs.push(ref);
  await writeManifest(slot.handle, manifest);
  return { ...scan, manifest };
}

/* ---------- installing: SDK (mod.io) ---------- */

const sanitize = (s: string) =>
  s.replace(/[^\w .()[\]{}'&+~!@#=-]/g, '_').trim() || 'mod';

async function writeFileAt(
  base: DirLike,
  relPath: string,
  data: Uint8Array,
): Promise<void> {
  const segs = relPath.split('/').filter(Boolean);
  const fname = segs.pop()!;
  let cur = base;
  for (const s of segs) cur = await cur.getDirectoryHandle(s, { create: true });
  const fh = await cur.getFileHandle(fname, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

export async function installMod(dir: DirLike, mod: ModioMod): Promise<string> {
  const url = mod.modfile?.download.binary_url;
  if (!url) throw new Error('No downloadable file for this mod');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const raw = unzipSync(buf);

  const entries = Object.entries(raw)
    .map(([name, data]) => ({
      name: name.replace(/\\/g, '/').replace(/^\.?\//, ''),
      data,
    }))
    .filter(
      (e) =>
        e.name &&
        !e.name.endsWith('/') &&
        !e.name.split('/').some((s) => s === '..'),
    );
  if (!entries.length) throw new Error('Empty archive');

  const tops = new Set(entries.map((e) => e.name.split('/')[0]));
  const commonRoot =
    tops.size === 1 && entries.every((e) => e.name.includes('/'))
      ? [...tops][0]
      : '';
  const base = commonRoot || sanitize(mod.name_id || `mod-${mod.id}`);

  for (const e of entries) {
    const rel = commonRoot ? e.name : `${base}/${e.name}`;
    await writeFileAt(dir, rel, e.data);
  }
  return commonRoot || base;
}

export async function recordInstall(
  slot: FolderSlot,
  scan: ScanResult,
  mod: ModioMod,
  folder: string,
): Promise<ScanResult> {
  const manifest: Manifest = {
    ...scan.manifest,
    mods: [
      ...scan.manifest.mods.filter((m) => m.id !== mod.id),
      {
        id: mod.id,
        name_id: mod.name_id,
        file: mod.modfile?.id ?? 0,
        folder,
        md5: mod.modfile?.filehash?.md5,
      },
    ],
    manual: scan.manifest.manual.filter((i) => i !== mod.id),
  };
  await writeManifest(slot.handle, manifest);
  return { ...scan, manifest };
}

/* ---------- installing: code mods (thunderstore) ---------- */

const TS_META = /^(icon\.png|manifest\.json|readme.*|changelog.*|license.*|\.ds_store)$/i;

export interface TsInstallResult {
  via: 'folder' | 'download';
  files: string[];
  skipped: string[];
  url?: string;
}

/**
 * Install a Thunderstore package into the code-mods slot.
 * Zip layout (verified): metadata at root (icon/manifest/readme) plus payload
 * dirs — `Mods/*` lands in the Mods dir; `Plugins/`, `UserData/` etc. land at
 * the game root when we have it, otherwise they're counted as skipped.
 * Loose files at zip root go into the Mods dir.
 *
 * ccdn.thunderstore.io sends no CORS headers, so the fetch usually fails in
 * the browser → returns {via:'download'} and the caller offers a normal
 * browser download instead. A user-supplied proxy URL can make it work.
 */
export async function installTs(
  slot: FolderSlot,
  pkg: TsPackage,
  proxyBase = '',
): Promise<TsInstallResult> {
  const ver = latest(pkg);
  if (!ver) throw new Error('No available version');

  // candidate download URLs: custom proxy → same-origin Pages proxy → direct
  const candidates: string[] = [];
  if (proxyBase)
    candidates.push(proxyBase + encodeURIComponent(ver.download_url));
  candidates.push('/api/proxy?url=' + encodeURIComponent(ver.download_url));
  candidates.push(ver.download_url);

  let res: Response | null = null;
  for (const u of candidates) {
    try {
      const r = await fetch(u);
      if (r.ok) {
        res = r;
        break;
      }
    } catch {
      /* try next candidate */
    }
  }
  if (!res)
    return { via: 'download', files: [], skipped: [], url: ver.download_url };

  const buf = new Uint8Array(await res.arrayBuffer());
  const raw = unzipSync(buf);
  const entries = Object.entries(raw)
    .map(([name, data]) => ({
      name: name.replace(/\\/g, '/').replace(/^\.?\//, ''),
      data,
    }))
    .filter(
      (e) =>
        e.name &&
        !e.name.endsWith('/') &&
        !e.name.split('/').some((s) => s === '..'),
    );
  if (!entries.length) throw new Error('Empty archive');

  const modsDir = await modsDirOf(slot);
  const files: string[] = [];
  const skipped: string[] = [];

  for (const e of entries) {
    const segs = e.name.split('/');
    const top = segs[0];
    const isRootFile = segs.length === 1;
    if (isRootFile && TS_META.test(top)) continue;

    if (!isRootFile && top.toLowerCase() === 'mods') {
      const rel = segs.slice(1).join('/');
      await writeFileAt(modsDir, rel, e.data);
      files.push(`Mods/${rel}`);
    } else if (isRootFile) {
      await writeFileAt(modsDir, e.name, e.data);
      files.push(`Mods/${e.name}`);
    } else if (slot.mode === 'root') {
      await writeFileAt(slot.handle, e.name, e.data);
      files.push(e.name);
    } else {
      skipped.push(e.name);
    }
  }
  return { via: 'folder', files, skipped };
}

export async function recordInstallPkg(
  slot: FolderSlot,
  scan: ScanResult,
  ref: string,
  ver: string,
  files: string[],
): Promise<ScanResult> {
  const manifest: Manifest = {
    ...scan.manifest,
    pkgs: [
      ...scan.manifest.pkgs.filter((p) => p.ref !== ref),
      { ref, ver, files },
    ],
    manualPkgs: scan.manifest.manualPkgs.filter((r) => r !== ref),
  };
  await writeManifest(slot.handle, manifest);
  return { ...scan, manifest };
}
