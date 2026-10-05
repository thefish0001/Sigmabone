import { useEffect, useState } from 'react';
import { encodeCollection, type Collection } from '../lib/collection';
import { getShared } from '../lib/shared';
import { fsSupported } from '../lib/fs';
import { connectAny } from '../components';
import CollectionView from './CollectionView';

type Shared = Collection | 'down' | null;

export default function Home() {
  const [shared, setShared] = useState<Shared>(null);
  const [busy, setBusy] = useState(false);

  /* the group's shared collection — if it has mods it IS the homepage */
  useEffect(() => {
    getShared().then((c) => setShared(c ?? 'down'));
  }, []);

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

  if (shared === null)
    return (
      <div className="wrap">
        <div className="list">
          <div className="skel h1" />
          {[0, 1, 2, 3].map((i) => (
            <div className="skel row" key={i} />
          ))}
        </div>
      </div>
    );

  /* populated shared collection → straight into the checklist */
  if (shared !== 'down' && shared.m.length + shared.t.length > 0)
    return <CollectionView data={encodeCollection(shared)} />;

  const down = shared === 'down';

  return (
    <div className="wrap">
      <div className="card empty-state home-empty">
        <div className="kicker">Sigmabone</div>
        <h1>{down ? 'Shared collection' : 'The collection is empty'}</h1>
        <p className="muted">
          {down
            ? "The shared store isn't answering — this deployment has no KV binding. You can still build a collection below."
            : 'Nothing here yet. Add mods and publish — everyone who opens this page gets the same list.'}
        </p>
        <div className="row center">
          <a className="btn primary" href="#/new">
            Add mods
          </a>
          {fsSupported() && (
            <button className="btn ghost" onClick={connect} disabled={busy}>
              {busy ? 'Scanning…' : 'Link mod folders'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
