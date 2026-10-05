import { useEffect, useState } from 'react';
import { useStore } from './store';
import { ModioError, probeServerKey, resolveGameId } from './lib/modio';
import { loadHandle, scanSlot } from './lib/fs';
import { FoldersMenu, Toasts } from './components';
import Home from './views/Home';
import Builder from './views/Builder';
import CollectionView from './views/CollectionView';

function useHash(): string {
  const [h, setH] = useState(() => location.hash);
  useEffect(() => {
    const f = () => setH(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h;
}

export default function App() {
  const hash = useHash();
  const { apiKey, gameId, setGameId, setKeyError, setKeyless, setSlot } =
    useStore();

  /* probe for the server-keyed Pages proxy, then resolve the game id */
  useEffect(() => {
    if (gameId) return;
    let dead = false;
    (async () => {
      const proxied = await probeServerKey().catch(() => false);
      if (dead) return;
      if (proxied) setKeyless(true);
      if (!proxied && !apiKey) return;
      try {
        const id = await resolveGameId(apiKey);
        if (!dead) {
          setGameId(id);
          setKeyError('');
        }
      } catch (e) {
        if (dead) return;
        setKeyError(
          e instanceof ModioError && e.unauthorized
            ? 'invalid'
            : e instanceof Error
              ? e.message
              : 'Failed to reach mod.io',
        );
      }
    })();
    return () => {
      dead = true;
    };
  }, [apiKey, gameId, setGameId, setKeyError, setKeyless]);

  /* restore saved folder handles (sdk + code) */
  useEffect(() => {
    let dead = false;
    (async () => {
      for (const kind of ['sdk', 'code'] as const) {
        try {
          const slot = await loadHandle(kind);
          if (!slot || dead) continue;
          if (
            (await slot.handle.queryPermission({ mode: 'readwrite' })) ===
            'granted'
          ) {
            const scan = await scanSlot(slot);
            if (!dead) setSlot(kind, slot, scan);
          } else if (!dead) {
            setSlot(kind, slot, null, true);
          }
        } catch {
          /* stale handle */
        }
      }
    })();
    return () => {
      dead = true;
    };
  }, [setSlot]);

  let view;
  if (hash.startsWith('#c=')) view = <CollectionView data={hash.slice(3)} />;
  else if (hash === '#/new' || hash === '#new') view = <Builder />;
  else view = <Home />;

  return (
    <div className="app">
      <header className="top">
        <a className="wordmark" href="#/">
          SIGMA<span>BONE</span>
        </a>
        <nav>
          <a href="#/new">New collection</a>
          <FoldersMenu />
        </nav>
      </header>
      <main>{view}</main>
      <footer className="foot">
        <span className="muted">
          collections live entirely in the link · mods served by{' '}
          <a href="https://mod.io/g/bonelab" target="_blank" rel="noreferrer">
            mod.io
          </a>{' '}
          &{' '}
          <a
            href="https://thunderstore.io/c/bonelab/"
            target="_blank"
            rel="noreferrer"
          >
            thunderstore
          </a>
        </span>
      </footer>
      <Toasts />
    </div>
  );
}
