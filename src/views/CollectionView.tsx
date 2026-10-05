import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { decodeCollection, type Collection } from '../lib/collection';
import { fmtBytes, getMod, getModsByIds, type ModioMod } from '../lib/modio';
import {
  depRef,
  getPackages,
  latest,
  type TsPackage,
} from '../lib/thunderstore';
import {
  fsSupported,
  installMod,
  installTs,
  markManual,
  markManualPkg,
  recordInstall,
  recordInstallPkg,
  type FolderKind,
  type ScanResult,
} from '../lib/fs';
import { statusFor, statusForPkg, type InstallStatus } from '../lib/match';
import { ApiDown, connectAny, Pill, SourceTag, Thumb } from '../components';

type RowState = 'idle' | 'doing' | 'done' | 'fail' | 'downloaded';

interface MRow {
  kind: 'm';
  mod: ModioMod;
  status: InstallStatus;
  via: string | null;
  folder?: string;
}
interface TRow {
  kind: 't';
  pkg: TsPackage;
  status: InstallStatus;
  via: string | null;
  folder?: string;
}

export default function CollectionView({ data }: { data: string }) {
  const {
    apiKey,
    gameId,
    keyError,
    sdk,
    code,
    sdkScan,
    codeScan,
    setScan,
    setDraft,
    proxy,
    toast,
  } = useStore();

  const [col, setCol] = useState<Collection | null>(null);
  const [decodeErr, setDecodeErr] = useState(false);
  const [mods, setMods] = useState<ModioMod[] | null>(null);
  const [pkgs, setPkgs] = useState<TsPackage[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  const [connectBusy, setConnectBusy] = useState<FolderKind | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      setCol(decodeCollection(data));
    } catch {
      setDecodeErr(true);
    }
  }, [data]);

  /* load mod.io mods */
  useEffect(() => {
    if (!col || !gameId || !col.m.length) {
      if (col) setMods([]);
      return;
    }
    let dead = false;
    getModsByIds(
      apiKey,
      gameId,
      col.m.map((e) => e.i),
    )
      .then((list) => {
        if (dead) return;
        const byId = new Map(list.map((m) => [m.id, m]));
        setMods(col.m.map((e) => byId.get(e.i)).filter(Boolean) as ModioMod[]);
      })
      .catch((e) => !dead && setLoadErr(e?.message ?? 'Failed to load mods'));
    return () => {
      dead = true;
    };
  }, [col, apiKey, gameId]);

  /* load thunderstore packages */
  useEffect(() => {
    if (!col || !col.t.length) {
      if (col) setPkgs([]);
      return;
    }
    let dead = false;
    getPackages()
      .then((all) => {
        if (dead) return;
        const byRef = new Map(all.map((p) => [p.full_name, p]));
        setPkgs(
          col.t
            .map((r) => byRef.get(r))
            .filter(Boolean) as TsPackage[],
        );
      })
      .catch(() => !dead && setLoadErr('Failed to load Thunderstore index'));
    return () => {
      dead = true;
    };
  }, [col]);

  const mRows: MRow[] = useMemo(
    () =>
      (mods ?? []).map((mod) => {
        const st = statusFor(mod, sdkScan);
        return {
          kind: 'm' as const,
          mod,
          status: st.status,
          via: st.via,
          folder: st.folder,
        };
      }),
    [mods, sdkScan],
  );

  const tRows: TRow[] = useMemo(
    () =>
      (pkgs ?? []).map((pkg) => {
        const st = statusForPkg(pkg, codeScan);
        return {
          kind: 't' as const,
          pkg,
          status: st.status,
          via: st.via,
          folder: st.folder,
        };
      }),
    [pkgs, codeScan],
  );

  const missingM = mRows.filter((r) => r.status === 'missing');
  const missingT = tRows.filter((r) => r.status === 'missing');
  const missingCount = missingM.length + missingT.length;
  const installedCount = [...mRows, ...tRows].filter(
    (r) => r.status === 'installed',
  ).length;
  const missingBytes =
    missingM.reduce((n, r) => n + (r.mod.modfile?.filesize ?? 0), 0) +
    missingT.reduce((n, r) => n + (latest(r.pkg)?.file_size ?? 0), 0);

  const setState = (key: string, s: RowState, msg = '') => {
    setRowState((p) => ({ ...p, [key]: s }));
    setRowMsg((p) => ({ ...p, [key]: msg }));
  };

  const installSdkRow = async (mod: ModioMod, curScan: ScanResult) => {
    if (!sdk || !gameId) return curScan;
    try {
      const fresh = await getMod(apiKey, gameId, mod.id);
      const folder = await installMod(sdk.handle, fresh);
      const s = await recordInstall(sdk, curScan, fresh, folder);
      setScan('sdk', s);
      setState(`m${mod.id}`, 'done');
      return s;
    } catch (e) {
      setState(`m${mod.id}`, 'fail', e instanceof Error ? e.message : 'failed');
      return curScan;
    }
  };

  const installTsRow = async (pkg: TsPackage, curScan: ScanResult) => {
    if (!code) return curScan;
    try {
      const r = await installTs(code, pkg, proxy);
      if (r.via === 'download') {
        const a = document.createElement('a');
        a.href = r.url!;
        a.rel = 'noreferrer';
        a.click();
        setState(
          `t${pkg.full_name}`,
          'downloaded',
          'zip went to Downloads — extract into your Mods folder',
        );
        return curScan;
      }
      const s = await recordInstallPkg(
        code,
        curScan,
        pkg.full_name,
        latest(pkg)?.version_number ?? '',
        r.files,
      );
      setScan('code', s);
      setState(`t${pkg.full_name}`, 'done');
      return s;
    } catch (e) {
      setState(
        `t${pkg.full_name}`,
        'fail',
        e instanceof Error ? e.message : 'failed',
      );
      return curScan;
    }
  };

  const installAll = async () => {
    setInstalling(true);
    if (sdkScan && sdk) {
      let cur = sdkScan;
      for (const r of missingM) {
        if (rowState[`m${r.mod.id}`] === 'done') continue;
        setState(`m${r.mod.id}`, 'doing');
        cur = (await installSdkRow(r.mod, cur)) ?? cur;
      }
    }
    if (codeScan && code) {
      let cur = codeScan;
      for (const r of missingT) {
        const st = rowState[`t${r.pkg.full_name}`];
        if (st === 'done' || st === 'downloaded') continue;
        setState(`t${r.pkg.full_name}`, 'doing');
        cur = (await installTsRow(r.pkg, cur)) ?? cur;
      }
    }
    setInstalling(false);
  };

  const manualDownloadTs = (pkg: TsPackage) => {
    const v = latest(pkg);
    if (!v) return;
    const a = document.createElement('a');
    a.href = v.download_url;
    a.rel = 'noreferrer';
    a.click();
  };

  const connect = async (kind: FolderKind) => {
    setConnectBusy(kind);
    try {
      await connectAny();
    } catch {
      /* cancelled */
    } finally {
      setConnectBusy(null);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Could not copy link', 'err');
    }
  };

  const openInBuilder = () => {
    if (!col) return;
    setDraft({ m: col.m.map((e) => e.i), t: col.t }, col.n);
    location.hash = '#/new';
  };

  if (decodeErr)
    return (
      <div className="wrap">
        <div className="card empty-state">
          <h2>Broken link</h2>
          <p className="muted">This collection link couldn't be decoded.</p>
          <a className="btn primary" href="#/">
            Back home
          </a>
        </div>
      </div>
    );

  /* sdk mods need the api; thunderstore-only collections don't */
  const needsApi = !col || col.m.length > 0;
  if (!gameId && needsApi)
    return (
      <div className="wrap">
        {keyError ? (
          <ApiDown />
        ) : (
          <div className="list">
            <div className="skel h1" />
            {[0, 1, 2, 3].map((i) => (
              <div className="skel row" key={i} />
            ))}
          </div>
        )}
      </div>
    );

  const loading = !col || mods === null || pkgs === null;
  if (loading)
    return (
      <div className="wrap">
        {loadErr ? (
          <div className="card empty-state">
            <h2>Couldn't load collection</h2>
            <p className="err">{loadErr}</p>
          </div>
        ) : (
          <div className="list">
            <div className="skel h1" />
            {[0, 1, 2, 3].map((i) => (
              <div className="skel row" key={i} />
            ))}
          </div>
        )}
      </div>
    );

  const totalRows = mRows.length + tRows.length;
  const canInstallAll =
    (missingM.length > 0 && !!sdkScan) || (missingT.length > 0 && !!codeScan);

  return (
    <div className="wrap collection">
      <div className="col-head">
        <div>
          <div className="kicker">Collection</div>
          <h1>{col!.n || 'Untitled collection'}</h1>
          <p className="muted">
            {mRows.length > 0 && `${mRows.length} sdk mods`}
            {mRows.length > 0 && tRows.length > 0 && ' · '}
            {tRows.length > 0 && `${tRows.length} code mods`}
            {(sdkScan || codeScan) &&
              ` · ${installedCount} installed · ${missingCount} missing`}
            {missingBytes > 0 && ` · ${fmtBytes(missingBytes)} to download`}
          </p>
        </div>
        <div className="col-actions">
          <button className="btn ghost" onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button className="btn ghost" onClick={openInBuilder}>
            Edit in builder
          </button>
        </div>
      </div>

      {!fsSupported() && (
        <div className="banner">
          <span>
            This browser can't access your folders — open this link in Chrome or
            Edge for auto-detect + one-click install. Manual downloads still
            work below.
          </span>
        </div>
      )}

      {/* -------- SDK mods -------- */}
      {mRows.length > 0 && (
        <section className="group">
          <div className="group-head">
            <SourceTag src="m" />
            <h2>SDK mods</h2>
            <span className="muted">
              LocalLow\…\BONELAB\Mods
              {sdkScan && missingM.length > 0 && ` · ${missingM.length} missing`}
            </span>
            {!sdkScan && fsSupported() && (
              <button
                className="btn sm primary"
                onClick={() => connect('sdk')}
                disabled={connectBusy !== null}
              >
                {connectBusy === 'sdk' ? '…' : 'Connect folder'}
              </button>
            )}
          </div>
          <div className="list">
            {mRows.map((r) => {
              const key = `m${r.mod.id}`;
              const st = rowState[key] ?? 'idle';
              return (
                <div className="mrow" key={key}>
                  <Thumb src={r.mod.logo?.thumb_320x180} alt={r.mod.name} />
                  <div className="mrow-info">
                    <a
                      href={r.mod.profile_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mrow-name"
                    >
                      {r.mod.name}
                    </a>
                    <div className="mrow-meta muted">
                      {r.mod.modfile?.version && (
                        <span>v{r.mod.modfile.version} · </span>
                      )}
                      {fmtBytes(r.mod.modfile?.filesize ?? 0)}
                      {r.folder && <span> · in “{r.folder}”</span>}
                      {r.via === 'manual' && <span> · marked by you</span>}
                      {(st === 'fail' || st === 'downloaded') &&
                        rowMsg[key] && (
                          <span className="err"> · {rowMsg[key]}</span>
                        )}
                    </div>
                  </div>
                  <Pill status={st === 'done' ? 'installed' : r.status} />
                  <div className="mrow-actions">
                    {r.status === 'likely' && sdkScan && sdk && (
                      <button
                        className="btn sm primary"
                        onClick={async () =>
                          setScan(
                            'sdk',
                            await markManual(sdk, sdkScan, r.mod.id, true),
                          )
                        }
                      >
                        Confirm
                      </button>
                    )}
                    {(r.status === 'missing' || r.status === 'likely') &&
                      sdkScan &&
                      sdk && (
                        <button
                          className="btn sm primary"
                          disabled={st === 'doing' || installing}
                          onClick={async () => {
                            setState(key, 'doing');
                            await installSdkRow(r.mod, sdkScan);
                          }}
                        >
                          {st === 'doing' ? '…' : 'Install'}
                        </button>
                      )}
                    {(r.status === 'missing' || r.status === 'likely') && (
                      <>
                        <button
                          className="btn sm ghost"
                          onClick={() => {
                            const url = r.mod.modfile?.download.binary_url;
                            if (!url) return;
                            const a = document.createElement('a');
                            a.href = url;
                            a.download =
                              r.mod.modfile!.filename || 'mod.zip';
                            a.rel = 'noreferrer';
                            a.click();
                          }}
                          title="Download zip to your Downloads folder"
                        >
                          ↓ zip
                        </button>
                        {sdkScan && sdk && r.status === 'missing' && (
                          <button
                            className="btn sm ghost"
                            onClick={async () =>
                              setScan(
                                'sdk',
                                await markManual(sdk, sdkScan, r.mod.id, true),
                              )
                            }
                          >
                            Have it
                          </button>
                        )}
                      </>
                    )}
                    {r.via === 'manual' && sdk && sdkScan && (
                      <button
                        className="btn sm ghost"
                        onClick={async () =>
                          setScan(
                            'sdk',
                            await markManual(sdk, sdkScan, r.mod.id, false),
                          )
                        }
                      >
                        Unmark
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* -------- code mods -------- */}
      {tRows.length > 0 && (
        <section className="group">
          <div className="group-head">
            <SourceTag src="t" />
            <h2>Code mods</h2>
            <span className="muted">
              game folder\Mods — MelonLoader
              {codeScan && missingT.length > 0 && ` · ${missingT.length} missing`}
            </span>
            {!codeScan && fsSupported() && (
              <button
                className="btn sm primary"
                onClick={() => connect('code')}
                disabled={connectBusy !== null}
              >
                {connectBusy === 'code' ? '…' : 'Connect folder'}
              </button>
            )}
          </div>
          <div className="list">
            {tRows.map((r) => {
              const key = `t${r.pkg.full_name}`;
              const st = rowState[key] ?? 'idle';
              const v = latest(r.pkg);
              const deps = (v?.dependencies ?? []).map(depRef);
              return (
                <div className="mrow" key={key}>
                  <Thumb src={v?.icon} alt={r.pkg.name} className="sq" />
                  <div className="mrow-info">
                    <a
                      href={r.pkg.package_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mrow-name"
                    >
                      {r.pkg.name}
                      {r.pkg.is_deprecated && (
                        <span className="dep-badge">deprecated</span>
                      )}
                    </a>
                    <div className="mrow-meta muted">
                      {r.pkg.owner} · v{v?.version_number} ·{' '}
                      {fmtBytes(v?.file_size ?? 0)}
                      {deps.length > 0 && (
                        <span> · needs {deps.join(', ')}</span>
                      )}
                      {r.folder && <span> · in “{r.folder}”</span>}
                      {r.via === 'manual' && <span> · marked by you</span>}
                      {(st === 'fail' || st === 'downloaded') &&
                        rowMsg[key] && (
                          <span className="err"> · {rowMsg[key]}</span>
                        )}
                    </div>
                  </div>
                  <Pill status={st === 'done' ? 'installed' : r.status} />
                  <div className="mrow-actions">
                    {r.status === 'likely' && codeScan && code && (
                      <button
                        className="btn sm primary"
                        onClick={async () =>
                          setScan(
                            'code',
                            await markManualPkg(
                              code,
                              codeScan,
                              r.pkg.full_name,
                              true,
                            ),
                          )
                        }
                      >
                        Confirm
                      </button>
                    )}
                    {(r.status === 'missing' || r.status === 'likely') &&
                      codeScan &&
                      code && (
                        <button
                          className="btn sm primary"
                          disabled={st === 'doing' || installing}
                          onClick={async () => {
                            setState(key, 'doing');
                            await installTsRow(r.pkg, codeScan);
                          }}
                        >
                          {st === 'doing' ? '…' : 'Install'}
                        </button>
                      )}
                    {(r.status === 'missing' || r.status === 'likely') && (
                      <>
                        <button
                          className="btn sm ghost"
                          onClick={() => manualDownloadTs(r.pkg)}
                          title="Download zip to your Downloads folder"
                        >
                          ↓ zip
                        </button>
                        {codeScan && code && r.status === 'missing' && (
                          <button
                            className="btn sm ghost"
                            onClick={async () =>
                              setScan(
                                'code',
                                await markManualPkg(
                                  code,
                                  codeScan,
                                  r.pkg.full_name,
                                  true,
                                ),
                              )
                            }
                          >
                            Have it
                          </button>
                        )}
                      </>
                    )}
                    {r.via === 'manual' && code && codeScan && (
                      <button
                        className="btn sm ghost"
                        onClick={async () =>
                          setScan(
                            'code',
                            await markManualPkg(
                              code,
                              codeScan,
                              r.pkg.full_name,
                              false,
                            ),
                          )
                        }
                      >
                        Unmark
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!totalRows && (
        <div className="card empty-state">
          <p className="muted">This collection is empty.</p>
        </div>
      )}

      {missingCount > 0 && (sdkScan || codeScan) && (
        <div className="footer-bar">
          <span>
            {missingCount} missing
            {missingBytes > 0 && ` · ${fmtBytes(missingBytes)}`}
            {!sdkScan && missingM.length > 0 && ' · sdk folder not connected'}
            {!codeScan && missingT.length > 0 && ' · code folder not connected'}
          </span>
          <button
            className="btn primary"
            onClick={installAll}
            disabled={installing || !canInstallAll}
          >
            {installing ? 'Installing…' : `Install all missing (${missingCount})`}
          </button>
        </div>
      )}
      {!missingCount && totalRows > 0 && (sdkScan || codeScan) && (
        <div className="footer-bar done">
          <span className="ok">You have everything in this collection.</span>
        </div>
      )}
    </div>
  );
}
