import { create } from 'zustand';
import type { FolderKind, FolderSlot, ScanResult } from './lib/fs';

const LS_KEY = 'sb.apiKey';
const LS_DRAFT = 'sb.draft2';
const LS_DRAFT_NAME = 'sb.draftName';
const LS_PROXY = 'sb.proxy';

const envKey =
  (import.meta.env.VITE_MODIO_API_KEY as string | undefined) ?? '';

export interface Draft {
  m: number[];
  t: string[];
}

export interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'err' | 'info';
}

interface AppState {
  apiKey: string;
  keyError: string;
  keyless: boolean;
  gameId: number | null;
  proxy: string;

  sdk: FolderSlot | null;
  code: FolderSlot | null;
  sdkNeedsGesture: boolean;
  codeNeedsGesture: boolean;
  sdkScan: ScanResult | null;
  codeScan: ScanResult | null;

  draft: Draft;
  draftName: string;
  toasts: Toast[];

  setApiKey(k: string): void;
  setKeyError(e: string): void;
  setKeyless(b: boolean): void;
  setGameId(id: number | null): void;
  setProxy(p: string): void;
  setSlot(kind: FolderKind, slot: FolderSlot | null, scan?: ScanResult | null, needsGesture?: boolean): void;
  setScan(kind: FolderKind, s: ScanResult | null): void;

  addDraftMod(id: number): void;
  addDraftPkg(ref: string): void;
  removeDraft(src: 'm' | 't', v: number | string): void;
  setDraft(d: Draft, name?: string): void;
  setDraftName(n: string): void;
  toast(msg: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
}

function loadDraft(): Draft {
  try {
    const v = JSON.parse(localStorage.getItem(LS_DRAFT) ?? 'null');
    if (v && Array.isArray(v.m) && Array.isArray(v.t))
      return {
        m: v.m.filter((n: unknown) => typeof n === 'number'),
        t: v.t.filter((s: unknown) => typeof s === 'string'),
      };
  } catch {
    /* ignore */
  }
  return { m: [], t: [] };
}

let toastSeq = 1;

export const useStore = create<AppState>((set, get) => ({
  apiKey: localStorage.getItem(LS_KEY) ?? envKey,
  keyError: '',
  keyless: false,
  gameId: null,
  proxy: localStorage.getItem(LS_PROXY) ?? '',

  sdk: null,
  code: null,
  sdkNeedsGesture: false,
  codeNeedsGesture: false,
  sdkScan: null,
  codeScan: null,

  draft: loadDraft(),
  draftName: localStorage.getItem(LS_DRAFT_NAME) ?? '',
  toasts: [],

  setApiKey: (apiKey) => {
    localStorage.setItem(LS_KEY, apiKey);
    set({ apiKey, keyError: '', gameId: null });
  },
  setKeyError: (keyError) => set({ keyError }),
  setKeyless: (keyless) => set({ keyless }),
  setGameId: (gameId) => set({ gameId }),
  setProxy: (proxy) => {
    localStorage.setItem(LS_PROXY, proxy);
    set({ proxy });
  },
  setSlot: (kind, slot, scan = null, needsGesture = false) =>
    set(
      kind === 'sdk'
        ? { sdk: slot, sdkScan: scan, sdkNeedsGesture: needsGesture }
        : { code: slot, codeScan: scan, codeNeedsGesture: needsGesture },
    ),
  setScan: (kind, scan) => set(kind === 'sdk' ? { sdkScan: scan } : { codeScan: scan }),

  addDraftMod: (id) => {
    const d = get().draft;
    if (d.m.includes(id)) return;
    const draft = { ...d, m: [...d.m, id] };
    localStorage.setItem(LS_DRAFT, JSON.stringify(draft));
    set({ draft });
  },
  addDraftPkg: (ref) => {
    const d = get().draft;
    if (d.t.includes(ref)) return;
    const draft = { ...d, t: [...d.t, ref] };
    localStorage.setItem(LS_DRAFT, JSON.stringify(draft));
    set({ draft });
  },
  removeDraft: (src, v) => {
    const d = get().draft;
    const draft =
      src === 'm'
        ? { ...d, m: d.m.filter((i) => i !== v) }
        : { ...d, t: d.t.filter((r) => r !== v) };
    localStorage.setItem(LS_DRAFT, JSON.stringify(draft));
    set({ draft });
  },
  setDraft: (draft, draftName) => {
    localStorage.setItem(LS_DRAFT, JSON.stringify(draft));
    if (draftName !== undefined) {
      localStorage.setItem(LS_DRAFT_NAME, draftName);
      set({ draft, draftName });
    } else set({ draft });
  },
  setDraftName: (draftName) => {
    localStorage.setItem(LS_DRAFT_NAME, draftName);
    set({ draftName });
  },
  toast: (msg, kind = 'info') => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, msg, kind }] }));
    setTimeout(() => get().dismissToast(id), 3400);
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
