/**
 * ============================================================================
 * Local Development Server (Static Bundle + Edge API Proxy)
 * ----------------------------------------------------------------------------
 * Compiles `./dist` via esbuild and serves both the frontend SPA and `/api/*`
 * routes (handled directly by `src/worker/index.ts`) on http://localhost:5173.
 * ============================================================================
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { app } from '../src/worker/index';
import { runBuild } from './build';

const PORT = Number(process.env.PORT || 5173);
const distDir = path.join(process.cwd(), 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function startDevServer(): Promise<void> {
  await runBuild();

  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url || '/';
    const parsedUrl = new URL(rawUrl, `http://${req.headers.host || `localhost:${PORT}`}`);

    if (parsedUrl.pathname.startsWith('/api/')) {
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const bodyBuffer = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') {
            headers.set(key, value);
          } else if (Array.isArray(value)) {
            headers.set(key, value.join(', '));
          }
        }

        const init: RequestInit = {
          method: req.method || 'GET',
          headers,
        };
        if (bodyBuffer && req.method !== 'GET' && req.method !== 'HEAD') {
          init.body = bodyBuffer;
        }

        const webResponse = await app.fetch(new Request(parsedUrl.toString(), init), {});
        res.statusCode = webResponse.status;
        webResponse.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });

        const payload = await webResponse.arrayBuffer();
        res.end(Buffer.from(payload));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Local API proxy error';
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: msg }));
      }
      return;
    }

    // Serve static file from ./dist (enforcing containment) or fall back to SPA index.html
    const requestedPath = parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname.replace(/^\/+/, '');
    const candidateFile = path.resolve(distDir, requestedPath);
    const withinDist =
      candidateFile === distDir || candidateFile.startsWith(distDir + path.sep);
    let targetFile =
      withinDist && fs.existsSync(candidateFile) && fs.statSync(candidateFile).isFile()
        ? candidateFile
        : path.join(distDir, 'index.html');

    const ext = path.extname(targetFile).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    fs.createReadStream(targetFile).pipe(res);
  });

  server.listen(PORT, () => {
    console.log(`UnfluffRecipes local dev server listening at http://localhost:${PORT}`);
  });
}

startDevServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
