import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import {
  fmtBytes,
  getMod,
  getModBySlug,
  getModsByIds,
  ModioError,
  searchMods,
  type ModioMod,
} from '../lib/modio';
import {
  byRef,
  depRef,
  getPackages,
  latest,
  parseTsUrl,
  searchPackages,
  type TsPackage,
} from '../lib/thunderstore';
import { parseModRef, parseShareLink, shareUrl } from '../lib/collection';
import { ApiDown, SourceTag, Thumb } from '../components';

type Src = 'm' | 't';

export default function Builder() {
  const {
    apiKey,
    gameId,
    keyError,
    draft,
    draftName,
    addDraftMod,
    addDraftPkg,
    removeDraft,
    setDraft,
    setDraftName,
    toast,
  } = useStore();

  const [src, setSrc] = useState<Src>('m');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ModioMod[] | null>(null);
  const [tsResults, setTsResults] = useState<TsPackage[] | null>(null);
  const [tsIndex, setTsIndex] = useState<TsPackage[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [ref, setRef] = useState('');
  const [refErr, setRefErr] = useState('');
  const [refBusy, setRefBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draftMods, setDraftMods] = useState<ModioMod[]>([]);
  const seq = useRef(0);

  /* warm the thunderstore index in the background */
  useEffect(() => {
    getPackages()
      .then(setTsIndex)
      .catch(() => toast("Couldn't reach Thunderstore", 'err'));
  }, [toast]);

  /* live search, debounced — source-aware */
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setResults(null);
      setTsResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        if (src === 'm') {
          if (!gameId) return;
          const r = await searchMods(apiKey, gameId, needle);
          if (seq.current !== id) return;
          r.sort(
            (a, b) =>
              (b.stats?.downloads_total ?? 0) - (a.stats?.downloads_total ?? 0),
          );
          setResults(r);
        } else {
          const all = tsIndex ?? (await getPackages());
          if (seq.current !== id) return;
          setTsIndex(all);
          setTsResults(searchPackages(all, needle));
        }
      } catch {
        if (seq.current === id) {
          if (src === 'm') setResults([]);
          else setTsResults([]);
        }
      } finally {
        if (seq.current === id) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, src, apiKey, gameId, tsIndex]);

  /* resolve draft mod.io ids → objects for display */
  useEffect(() => {
    if (!gameId || !draft.m.length) {
      setDraftMods([]);
      return;
    }
    let dead = false;
    getModsByIds(apiKey, gameId, draft.m)
      .then((mods) => {
        if (dead) return;
        const byId = new Map(mods.map((m) => [m.id, m]));
        setDraftMods(
          draft.m.map((id) => byId.get(id)).filter(Boolean) as ModioMod[],
        );
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [draft.m, apiKey, gameId]);

  const addPkg = (pkg: TsPackage) => {
    addDraftPkg(pkg.full_name);
    // auto-include missing dependencies (one level)
    const deps = (latest(pkg)?.dependencies ?? [])
      .map(depRef)
      .filter((r) => r !== pkg.full_name && !draft.t.includes(r) && tsIndex?.some((p) => p.full_name === r));
    for (const r of deps) addDraftPkg(r);
    toast(
      deps.length
        ? `Added ${pkg.name} + ${deps.length} dependenc${deps.length === 1 ? 'y' : 'ies'}`
        : `Added ${pkg.name}`,
      'ok',
    );
  };

  const addRef = async (e: React.FormEvent) => {
    e.preventDefault();
    setRefErr('');

    const shared = parseShareLink(ref);
    if (shared) {
      setDraft(
        {
          m: [...new Set([...draft.m, ...shared.m.map((x) => x.i)])],
          t: [...new Set([...draft.t, ...shared.t])],
        },
        draftName || shared.n,
      );
      toast(`Merged ${shared.m.length + shared.t.length} mods into your collection`, 'ok');
      setRef('');
      return;
    }

    const tsRef = parseTsUrl(ref);
    if (tsRef) {
      const all = tsIndex ?? (await getPackages().catch(() => null));
      const pkg = all?.find((p) => p.full_name === tsRef);
      if (pkg) {
        addPkg(pkg);
        setRef('');
      } else setRefErr('Thunderstore package not found');
      return;
    }

    const r = parseModRef(ref);
    if (!r) {
      setRefErr('Paste a mod.io link, thunderstore link, mod id, or sigmabone link');
      return;
    }
    if (!gameId) return;
    setRefBusy(true);
    try {
      const mod =
        r.kind === 'id'
          ? await getMod(apiKey, gameId, r.id).catch(() => null)
          : await getModBySlug(apiKey, gameId, r.slug);
      if (!mod) setRefErr('Mod not found');
      else {
        addDraftMod(mod.id);
        setRef('');
      }
    } catch (err) {
      setRefErr(err instanceof ModioError ? err.message : 'Lookup failed');
    } finally {
      setRefBusy(false);
    }
  };

  const total = draft.m.length + draft.t.length;
  const url = useMemo(
    () =>
      total
        ? shareUrl({
            v: 2,
            n: draftName,
            m: draft.m.map((i) => ({ i })),
            t: draft.t,
          })
        : '',
    [draft, draftName, total],
  );

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  if (!gameId)
    return (
      <div className="wrap">
        {keyError ? (
          <ApiDown />
        ) : (
          <div className="list">
            <div className="skel h1" />
            <div className="skel row" />
          </div>
        )}
      </div>
    );

  const shown = src === 'm' ? results : tsResults;

  return (
    <div className="wrap builder">
      <div className="builder-main">
        <h1>Build a collection</h1>

        <form className="row" onSubmit={addRef}>
          <input
            className="input"
            placeholder="Paste a mod.io / thunderstore / sigmabone link…"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            spellCheck={false}
          />
          <button className="btn ghost" disabled={refBusy || !ref.trim()}>
            {refBusy ? '…' : 'Add'}
          </button>
        </form>
        {refErr && <p className="err">{refErr}</p>}

        <div className="seg">
          <button
            className={src === 'm' ? 'on' : ''}
            onClick={() => setSrc('m')}
          >
            SDK mods
            <span className="seg-sub">mod.io</span>
          </button>
          <button
            className={src === 't' ? 'on' : ''}
            onClick={() => setSrc('t')}
          >
            Code mods
            <span className="seg-sub">thunderstore</span>
          </button>
        </div>

        <input
          className="input search"
          placeholder={
            src === 'm'
              ? 'Search mod.io for BONELAB mods…'
              : 'Search code mods — BoneLib, Fusion…'
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
          spellCheck={false}
        />

        {searching && <p className="muted searching">Searching…</p>}
        {shown && !shown.length && !searching && (
          <p className="muted searching">No mods found for “{q}”.</p>
        )}

        {shown && shown.length > 0 && (
          <div className="results">
            {src === 'm'
              ? (shown as ModioMod[]).map((m) => {
                  const inDraft = draft.m.includes(m.id);
                  return (
                    <div className="mcard" key={m.id}>
                      <Thumb src={m.logo?.thumb_320x180} alt={m.name} />
                      <div className="mcard-body">
                        <a
                          className="mcard-name"
                          href={m.profile_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {m.name}
                        </a>
                        <div className="mcard-meta muted">
                          {m.submitted_by?.username && (
                            <span>{m.submitted_by.username} · </span>
                          )}
                          {fmtBytes(m.modfile?.filesize ?? 0)}
                          {m.stats?.downloads_total != null && (
                            <span>
                              {' '}
                              · {m.stats.downloads_total.toLocaleString()} dl
                            </span>
                          )}
                        </div>
                        <button
                          className={'btn sm ' + (inDraft ? 'ghost' : 'primary')}
                          onClick={() =>
                            inDraft ? removeDraft('m', m.id) : addDraftMod(m.id)
                          }
                        >
                          {inDraft ? '✓ added' : '+ add'}
                        </button>
                      </div>
                    </div>
                  );
                })
              : (shown as TsPackage[]).map((p) => {
                  const v = latest(p);
                  const inDraft = draft.t.includes(p.full_name);
                  const deps = (v?.dependencies ?? []).length;
                  return (
                    <div className="mcard" key={p.full_name}>
                      <Thumb src={v?.icon} alt={p.name} className="sq" />
                      <div className="mcard-body">
                        <a
                          className="mcard-name"
                          href={p.package_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {p.name}
                          {p.is_deprecated && (
                            <span className="dep-badge">deprecated</span>
                          )}
                        </a>
                        <div className="mcard-meta muted">
                          {p.owner} · v{v?.version_number}
                          {v?.file_size ? ` · ${fmtBytes(v.file_size)}` : ''}
                          {deps > 0 && (
                            <span className="deps">
                              {' '}
                              · needs {deps} dep{deps === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        <button
                          className={'btn sm ' + (inDraft ? 'ghost' : 'primary')}
                          onClick={() =>
                            inDraft ? removeDraft('t', p.full_name) : addPkg(p)
                          }
                        >
                          {inDraft ? '✓ added' : '+ add'}
                        </button>
                      </div>
                    </div>
                  );
                })}
          </div>
        )}
        {!shown && !searching && (
          <p className="muted hint">
            {src === 'm'
              ? 'Search mod.io above or paste links — SDK mods install into LocalLow\\…\\BONELAB\\Mods.'
              : 'Search Thunderstore — code mods install into your game folder. Dependencies get added automatically.'}
          </p>
        )}
      </div>

      <aside className="builder-side card">
        <div className="kicker">Your collection</div>
        <input
          className="input name"
          placeholder="Collection name (optional)"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          maxLength={80}
        />
        {!total && <p className="muted">Empty — add mods from the left.</p>}

        {draft.m.length > 0 && (
          <div className="draft-group">
            <div className="dg-head">
              <SourceTag src="m" /> {draft.m.length} sdk
            </div>
            <div className="list">
              {draft.m.map((id) => {
                const m = draftMods.find((x) => x.id === id);
                return (
                  <div className="lrow" key={id}>
                    <div className="lrow-name">
                      {m ? m.name : `mod #${id}`}
                      {m?.modfile && (
                        <span className="muted">
                          {' '}
                          · {fmtBytes(m.modfile.filesize)}
                        </span>
                      )}
                    </div>
                    <button
                      className="x"
                      onClick={() => removeDraft('m', id)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {draft.t.length > 0 && (
          <div className="draft-group">
            <div className="dg-head">
              <SourceTag src="t" /> {draft.t.length} code
            </div>
            <div className="list">
              {draft.t.map((r) => {
                const p = tsIndex ? byRef(tsIndex, r) : undefined;
                return (
                  <div className="lrow" key={r}>
                    <div className="lrow-name">{p?.name ?? r}</div>
                    <button
                      className="x"
                      onClick={() => removeDraft('t', r)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="side-foot">
          <span className="muted">{total} mods</span>
          <button className="btn primary" onClick={copy} disabled={!total}>
            {copied ? 'Copied!' : 'Copy share link'}
          </button>
        </div>
        {!!total && (
          <>
            <input
              className="input url"
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
            />
            <button
              className="btn ghost sm"
              onClick={() => setDraft({ m: [], t: [] }, '')}
              style={{ marginTop: 8 }}
            >
              Clear collection
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
