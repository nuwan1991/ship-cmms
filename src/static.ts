import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

/**
 * Serve the built web app from the same process, so one installation is one program and one port (no CDN, no second server).
 * Any path that is not an API route and not a file falls back to index.html (client-side routing). Only files inside `dir` are ever served.
 */
export function mountStatic(app: FastifyInstance, dir: string): boolean {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html'))) return false;
  const index = readFileSync(join(root, 'index.html'));
  app.get('/*', async (req, reply) => {
    const path = decodeURIComponent((req.raw.url ?? '/').split('?')[0]!);
    if (path.startsWith('/api/')) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `No route ${req.method} ${path}`, correlationId: req.id } });
    const file = resolve(join(root, normalize(path)));
    if ((file === root || file.startsWith(root + sep)) && existsSync(file) && statSync(file).isFile()) {
      return reply.header('content-type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
        .header('cache-control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache').send(readFileSync(file));
    }
    return reply.header('content-type', MIME['.html']!).header('cache-control', 'no-cache').send(index);
  });
  return true;
}
