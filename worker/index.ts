// Worker entry — serves the static site from ASSETS and handles two API
// routes the CDNs can't serve directly:
//
//   GET /api/modio/*    → g-38.modapi.io, injecting the server-side
//                         MODIO_API_KEY secret so visitors stay keyless
//   GET /api/proxy?url= → same-origin stream-through download proxy for
//                         CORS-less CDNs (ccdn.thunderstore.io etc)
//
// Everything else falls through to the built SPA in ./dist.

interface Env {
  MODIO_API_KEY?: string;
  ASSETS: { fetch: typeof fetch };
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Modio-Platform',
};

const PROXY_HOST_SUFFIXES = ['thunderstore.io', 'modcdn.io', 'mod.io'];

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { headers: CORS });
    }
    if (url.pathname.startsWith('/api/modio/')) return modio(url, request, env);
    if (url.pathname === '/api/proxy') return proxy(url);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function modio(
  reqUrl: URL,
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.MODIO_API_KEY) {
    return Response.json(
      { error: { message: 'MODIO_API_KEY not configured on this deployment' } },
      { status: 503, headers: CORS },
    );
  }
  const upstream = new URL(
    `https://g-38.modapi.io/v1/${reqUrl.pathname.slice('/api/modio/'.length)}`,
  );
  upstream.search = reqUrl.search;
  upstream.searchParams.set('api_key', env.MODIO_API_KEY);

  const res = await fetch(upstream, {
    headers: {
      'X-Modio-Platform': request.headers.get('X-Modio-Platform') ?? 'windows',
    },
  });

  const headers = new Headers(CORS);
  headers.set(
    'content-type',
    res.headers.get('content-type') ?? 'application/json',
  );
  return new Response(res.body, { status: res.status, headers });
}

async function proxy(reqUrl: URL): Promise<Response> {
  const raw = reqUrl.searchParams.get('url');
  if (!raw) return new Response('missing url param', { status: 400 });

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return new Response('invalid url', { status: 400 });
  }
  const allowed =
    u.protocol === 'https:' &&
    PROXY_HOST_SUFFIXES.some(
      (s) => u.hostname === s || u.hostname.endsWith('.' + s),
    );
  if (!allowed) return new Response('host not allowed', { status: 403 });

  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': 'Sigmabone (mod-collection-sharer)' },
    redirect: 'follow',
  });

  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set(
    'content-type',
    res.headers.get('content-type') ?? 'application/octet-stream',
  );
  for (const h of ['content-length', 'content-disposition']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers });
}
