// Minimal ambient types so the worker file type-checks without pulling in
// the full @cloudflare/workers-types package.
interface ExportedHandler<E = unknown> {
  fetch?(request: Request, env: E, ctx: unknown): Response | Promise<Response>;
}
