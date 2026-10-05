// Cloudflare Pages Function — proxies api.mod.io with a server-side API key
// so visitors never need one. Key lives in the MODIO_API_KEY secret
// (Pages project settings → Environment variables).

interface Env {
  MODIO_API_KEY?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Modio-Platform',
};

export const onRequestOptions: PagesFunction = () =>
  new Response(null, { headers: CORS });

export const onRequestGet: PagesFunction<Env> = async ({
  params,
  request,
  env,
}) => {
  if (!env.MODIO_API_KEY) {
    return Response.json(
      { error: { message: 'MODIO_API_KEY not configured on this deployment' } },
      { status: 503, headers: CORS },
    );
  }
  const path = (params.path as string[]).join('/');
  const url = new URL(`https://api.mod.io/v1/${path}`);
  url.search = new URL(request.url).search;
  url.searchParams.set('api_key', env.MODIO_API_KEY);

  const upstream = await fetch(url, {
    headers: {
      'X-Modio-Platform':
        request.headers.get('X-Modio-Platform') ?? 'windows',
    },
  });

  const headers = new Headers();
  headers.set(
    'content-type',
    upstream.headers.get('content-type') ?? 'application/json',
  );
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
};
