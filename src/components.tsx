import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import {
  ensureWritable,
  forgetHandle,
  fsSupported,
  pickFolder,
  scanSlot,
  type FolderKind,
  type FolderSlot,
} from './lib/fs';
import type { InstallStatus } from './lib/match';

/* Connect flow: pick a folder → classify it → store under the detected slot. */
export async function connectAny(): Promise<FolderKind | null> {
  const slot = await pickFolder();
  const { setSlot, toast } = useStore.getState();
  try {
    const scan = await scanSlot(slot);
    setSlot(slot.kind, slot, scan);
    toast(
      slot.kind === 'sdk'
        ? `SDK mods folder connected — ${scan.names.length} mod folders found`
        : `Code mods connected (${slot.handle.name}${slot.mode === 'root' ? ' → Mods/' : ''})`,
      'ok',
    );
    return slot.kind;
  } catch {
    setSlot(slot.kind, slot);
    toast('Folder saved — scan it from the folders menu', 'info');
    return slot.kind;
  }
}

/** Rescan/re-permit an existing slot (used after reload or permission loss). */
export async function reconnect(slot: FolderSlot): Promise<void> {
  const { setSlot } = useStore.getState();
  if (!(await ensureWritable(slot.handle))) return;
  const scan = await scanSlot(slot);
  setSlot(slot.kind, slot, scan);
}

const SLOT_META: Record<
  FolderKind,
  { title: string; hint: string; icon: string }
> = {
  sdk: {
    title: 'SDK mods',
    hint: 'AppData\\LocalLow\\Stress Level Zero\\BONELAB\\Mods',
    icon: '◆',
  },
  code: {
    title: 'Code mods',
    hint: 'BONELAB game folder or its Mods\\ dir',
    icon: '⌘',
  },
};

function SlotRow({ kind }: { kind: FolderKind }) {
  const { sdk, code, sdkScan, codeScan, sdkNeedsGesture, codeNeedsGesture, setSlot, toast } =
    useStore();
  const slot = kind === 'sdk' ? sdk : code;
  const scan = kind === 'sdk' ? sdkScan : codeScan;
  const needsGesture = kind === 'sdk' ? sdkNeedsGesture : codeNeedsGesture;
  const meta = SLOT_META[kind];
  const [busy, setBusy] = useState(false);

  const onPick = async () => {
    setBusy(true);
    try {
      await connectAny();
    } catch {
      /* cancelled */
    } finally {
      setBusy(false);
    }
  };
  const onReconnect = async () => {
    if (!slot) return;
    setBusy(true);
    try {
      await reconnect(slot);
    } finally {
      setBusy(false);
    }
  };
  const onForget = async () => {
    await forgetHandle(kind);
    setSlot(kind, null);
    toast(`${meta.title} folder disconnected`);
  };

  return (
    <div className="slot">
      <span className={`slot-ic ${kind}`}>{meta.icon}</span>
      <div className="slot-body">
        <div className="slot-title">
          {meta.title}
          {scan && <span className="slot-dot ok" />}
        </div>
        <div className="slot-hint">
          {slot ? slot.handle.name : meta.hint}
          {scan &&
            ` · ${kind === 'sdk' ? `${scan.names.length} folders` : `${scan.files.filter((f) => f.toLowerCase().endsWith('.dll')).length} dlls`}`}
        </div>
      </div>
      <div className="slot-actions">
        {scan ? (
          <button className="btn sm ghost" onClick={onReconnect} disabled={busy}>
            Rescan
          </button>
        ) : slot || needsGesture ? (
          <button className="btn sm primary" onClick={onReconnect} disabled={busy}>
            Reconnect
          </button>
        ) : null}
        <button className="btn sm ghost" onClick={onPick} disabled={busy}>
          {busy ? '…' : slot ? 'Change' : 'Choose'}
        </button>
        {slot && (
          <button className="x" onClick={onForget} title="Forget this folder">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/** Header chip → popover managing both mod folders. */
export function FoldersMenu() {
  const { sdkScan, codeScan, sdk, code } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('mousedown', close);
    addEventListener('keydown', esc);
    return () => {
      removeEventListener('mousedown', close);
      removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!fsSupported())
    return (
      <span className="chip dim" title="Folder integration needs Chrome or Edge">
        no folder access
      </span>
    );

  const connected = (sdkScan ? 1 : 0) + (codeScan ? 1 : 0);
  const label =
    connected === 2
      ? 'Folders connected'
      : connected === 1
        ? '1 folder connected'
        : sdk || code
          ? 'Reconnect folders'
          : 'Connect folders';

  return (
    <div className="fmenu" ref={ref}>
      <button
        className={'chip' + (connected ? ' ok' : '')}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="dot" />
        {label}
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="popover" role="menu">
          <div className="pop-head">Mod folders</div>
          <SlotRow kind="sdk" />
          <SlotRow kind="code" />
          <div className="pop-foot">
            Pick any folder — Sigmabone detects which type it is automatically.
          </div>
          <ProxyField />
        </div>
      )}
    </div>
  );
}

/** Optional CORS proxy for direct code-mod installs. */
function ProxyField() {
  const { proxy, setProxy } = useStore();
  const [v, setV] = useState(proxy);
  return (
    <div className="pop-proxy">
      <label className="pop-label" htmlFor="proxy">
        Download proxy <span className="muted">(optional)</span>
      </label>
      <input
        id="proxy"
        className="input"
        placeholder="https://your-worker.dev/?url="
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => setProxy(v.trim())}
        spellCheck={false}
      />
      <div className="pop-note muted">
        Thunderstore's CDN blocks direct browser downloads — the hosted site
        includes a proxy so code mods install straight into the folder. Only
        set this if you're self-hosting without it.
      </div>
    </div>
  );
}

/** Shown when the deployment's mod.io backend can't be reached. */
export function ApiDown() {
  return (
    <div className="card apicard">
      <h3>Can't reach the mod.io backend</h3>
      <p className="muted">
        The site's API proxy isn't answering. If you deployed this yourself,
        the <code>MODIO_API_KEY</code> secret is missing or the Worker code
        wasn't deployed — set it under{' '}
        <em>Settings → Variables and Secrets</em> and redeploy.
      </p>
    </div>
  );
}

const PILL_LABEL: Record<InstallStatus, string> = {
  installed: 'installed',
  likely: 'probably installed',
  missing: 'missing',
  unavailable: 'no pc file',
};

export function Pill({ status }: { status: InstallStatus }) {
  return <span className={`pill ${status}`}>{PILL_LABEL[status]}</span>;
}

export function SourceTag({ src }: { src: 'm' | 't' }) {
  return (
    <span className={`stag ${src}`} title={src === 'm' ? 'SDK mod — mod.io' : 'Code mod — Thunderstore'}>
      {src === 'm' ? 'sdk' : 'code'}
    </span>
  );
}

export function Thumb({
  src,
  alt,
  className = '',
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [bad, setBad] = useState(false);
  if (!src || bad)
    return (
      <div className={`thumb ph ${className}`}>
        <span />
      </div>
    );
  return (
    <img
      className={`thumb ${className}`}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBad(true)}
    />
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
