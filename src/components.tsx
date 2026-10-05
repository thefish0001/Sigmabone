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

const ICON_PATHS = {
  library: 'M12 3 3 8v9l9 5 9-5V8L12 3Zm0 10 9-5M12 13 3 8m9 5v9M7.5 5.5l9 5',
  folder: 'M3 7V5h6l2 2h10v12H3V7Z',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  link: 'm10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
};

export function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/* Connect flow: pick a folder → classify it → store under the detected slot. */
export async function connectAny(kind?: FolderKind): Promise<FolderKind | null> {
  const slot = await pickFolder(kind);
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
  const [error, setError] = useState('');

  const onPick = async () => {
    setBusy(true);
    setError('');
    try {
      await connectAny(kind);
    } catch (e) {
      /* cancelled */
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError(e instanceof Error ? e.message : 'Could not connect folder');
    } finally {
      setBusy(false);
    }
  };
  const onReconnect = async () => {
    if (!slot) return;
    setBusy(true);
    setError('');
    try {
      await reconnect(slot);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reconnect folder');
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
    <div className={'slot' + (error ? ' slot-error' : '')}>
      <span className={`slot-ic ${kind}`}><Icon name={kind === 'sdk' ? 'library' : 'folder'} /></span>
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
      {error && <p className="err slot-message" role="alert">{error}</p>}
    </div>
  );
}

export function FolderGuide({ ready }: { ready: boolean }) {
  const { sdkScan, codeScan } = useStore();
  const [dismissed, setDismissed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const show = ready && !dismissed && (!sdkScan || !codeScan);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (show && !el.open) el.showModal();
    else if (!show && el.open) el.close();
    if (!show) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [show]);

  return (
    <dialog ref={dialog} className="folder-guide" aria-labelledby="folder-guide-title" aria-describedby="folder-guide-description" onClose={() => setDismissed(true)}>
      <button className="x guide-close" aria-label="Close folder guide" onClick={() => dialog.current?.close()} autoFocus>×</button>
      <h2 id="folder-guide-title">Connect your mod folders</h2>
      <p id="folder-guide-description" className="muted">Recommended — lets Sigmabone check what you have and install in the right place.</p>
      <div className="guide-row">
        <h3><Icon name="library" /> SDK mods <span className="muted">mod.io</span></h3>
        <code>{'%USERPROFILE%\\AppData\\LocalLow\\Stress Level Zero\\BONELAB\\Mods'}</code>
        {fsSupported() && <SlotRow kind="sdk" />}
      </div>
      <div className="guide-row">
        <h3><Icon name="folder" /> Code mods <span className="muted">MelonLoader</span></h3>
        <code>{'C:\\Program Files (x86)\\Steam\\steamapps\\common\\BONELAB'}</code>
        <p className="guide-hint muted">The game folder or the Mods folder inside it.</p>
        {fsSupported() && <SlotRow kind="code" />}
      </div>
      {!fsSupported() && <p className="banner">Folder access requires Chrome or Edge on PC. You can still browse mods and download ZIP files in this browser.</p>}
      <div className="guide-footer">
        <button className="btn primary" onClick={() => dialog.current?.close()}>Continue</button>
      </div>
    </dialog>
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
        <Icon name="folder" />
        {label}
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="popover" role="region" aria-label="Mod folders">
          <div className="pop-head">Your local library</div>
          <p className="pop-description">Connect the folders where your mods live.</p>
          <SlotRow kind="sdk" />
          <SlotRow kind="code" />
          <div className="pop-foot">
            Choose the LocalLow Mods folder for SDK mods and the game folder for code mods.
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
