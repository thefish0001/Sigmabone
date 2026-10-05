// Cloudflare Pages Function — same-origin download proxy for CDNs that
// don't send CORS headers (ccdn.thunderstore.io etc). Streams the response
// body, so multi-hundred-MB mod zips pass through unbuffered.
//
// GET /api/proxy?url=<encoded-url>

const ALLOWED_HOST_SUFFIXES = [
  'thunderstore.io',
  'modcdn.io',
  'mod.io',
];

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export const onRequestOptions: PagesFunction = () =>
  new Response(null, { headers: CORS });

export const onRequestGet: PagesFunction = async ({ request }) => {
  const raw = new URL(request.url).searchParams.get('url');
  if (!raw) return new Response('missing url param', { status: 400 });

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return new Response('invalid url', { status: 400 });
  }

  const allowed =
    u.protocol === 'https:' &&
    ALLOWED_HOST_SUFFIXES.some(
      (s) => u.hostname === s || u.hostname.endsWith('.' + s),
    );
  if (!allowed) return new Response('host not allowed', { status: 403 });

  const upstream = await fetch(u.toString(), {
    headers: { 'User-Agent': 'Sigmabone (+github-pages-static-site)' },
    redirect: 'follow',
  });

  const headers = new Headers();
  headers.set(
    'content-type',
    upstream.headers.get('content-type') ?? 'application/octet-stream',
  );
  const len = upstream.headers.get('content-length');
  if (len) headers.set('content-length', len);
  const disp = upstream.headers.get('content-disposition');
  if (disp) headers.set('content-disposition', disp);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
};
