import { useEffect, useState } from 'react';
import { encodeCollection, type Collection } from '../lib/collection';
import { getShared } from '../lib/shared';
import { fsSupported } from '../lib/fs';
import { connectAny, Icon } from '../components';
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

  /* populated shared collection → straight into the checklist */
  const data = encodeCollection(shared && shared !== 'down'
    ? shared
    : { v: 2, n: 'BONELAB mods', m: [], t: [] });

  return (
    <CollectionView
      key={data}
      data={data}
      loadingCollection={shared === null}
      collectionError={shared === 'down' ? 'The mod list could not be loaded. The shared collection service may be unavailable or its COLLECTION storage binding may be missing.' : ''}
      onRetry={() => {
        setShared(null);
        void getShared().then((c) => setShared(c ?? 'down'));
      }}
      emptyAction={fsSupported() && (
        <button className="btn ghost" onClick={connect} disabled={busy}>
          <Icon name="folder" /> {busy ? 'Scanning…' : 'Link mod folders'}
        </button>
      )}
    />
  );
}
