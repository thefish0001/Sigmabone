import { useState } from 'react';
import { useStore } from '../store';
import { decodeCollection } from '../lib/collection';
import { fsSupported } from '../lib/fs';
import { connectAny } from '../components';

export default function Home() {
  const { sdkScan, codeScan } = useStore();
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const m = link.match(/#?c=?([A-Za-z0-9_-]{6,})/);
    const data = m ? m[1] : link.trim();
    try {
      decodeCollection(data);
      location.hash = `#c=${data}`;
    } catch {
      setErr("That doesn't look like a collection link.");
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      await connectAny();
    } catch {
      /* cancelled */
    } finally {
      setBusy(false);
    }
  };

  const folders = (sdkScan ? 1 : 0) + (codeScan ? 1 : 0);

  return (
    <div className="wrap">
      <section className="hero">
        <h1>
          Share BONELAB mods
          <br />
          <span className="grad">as a single link.</span>
        </h1>
        <p>
          Build a collection — SDK mods <em>and</em> code mods — copy one URL.
          Whoever opens it sees exactly what they're missing and installs the
          rest straight into the right folders. No accounts, no server.
        </p>
      </section>

      <div className="grid cols3">
        <div className="card lift">
          <div className="kicker">Received a link?</div>
          <h3>Open a collection</h3>
          <form onSubmit={open}>
            <input
              className="input"
              placeholder="paste sigmabone link…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              spellCheck={false}
            />
            {err && <p className="err">{err}</p>}
            <button className="btn primary" disabled={!link.trim()}>
              Open
            </button>
          </form>
        </div>

        <div className="card lift">
          <div className="kicker">Make your own</div>
          <h3>Build a collection</h3>
          <p className="muted">
            Search mod.io &amp; Thunderstore or paste links, name it, copy the
            share URL. The whole collection lives inside the link — nothing is
            uploaded.
          </p>
          <a className="btn primary" href="#/new">
            New collection
          </a>
        </div>

        <div className="card lift">
          <div className="kicker">Your library</div>
          <h3>Mod folders</h3>
          {folders === 2 ? (
            <p className="muted">
              <span className="ok">Both connected</span> — SDK mods (
              {sdkScan!.names.length} folders) and code mods (
              {codeScan!.files.filter((f) => f.endsWith('.dll')).length} dlls).
            </p>
          ) : (
            <p className="muted">
              {fsSupported()
                ? 'Two places: LocalLow\\…\\BONELAB\\Mods for SDK mods and your game folder for code mods. Pick a folder — Sigmabone detects which it is.'
                : 'Your browser has no folder access — use Chrome or Edge for auto-detect and one-click install. Collections still work everywhere.'}
            </p>
          )}
          {fsSupported() && (
            <button className="btn ghost" onClick={connect} disabled={busy}>
              {busy ? 'Scanning…' : folders ? 'Add another folder' : 'Choose folder'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
