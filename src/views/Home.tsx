import { useEffect, useState } from 'react';
import {
  DEFAULT_COLLECTION,
  encodeCollection,
  type Collection,
} from '../lib/collection';
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

  /* the shared store wins when it has mods; the built-in default keeps the
     page working when KV is down or was never published to */
  const col =
    shared && shared !== 'down' && shared.m.length + shared.t.length > 0
      ? shared
      : DEFAULT_COLLECTION;
  const data = encodeCollection(col);

  return (
    <CollectionView
      key={data}
      data={data}
      emptyAction={fsSupported() && (
        <button className="btn ghost" onClick={connect} disabled={busy}>
          <Icon name="folder" /> {busy ? 'Scanning…' : 'Link mod folders'}
        </button>
      )}
    />
  );
}
