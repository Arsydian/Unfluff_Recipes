/**
 * ============================================================================
 * Production Frontend Bundler (esbuild)
 * ----------------------------------------------------------------------------
 * Bundles `src/client/main.tsx` and its imported retro-technical CSS into
 * `./dist/assets/main.js` and `./dist/assets/main.css` (plus lazy chunks for
 * client-side PDF export), copies `public/` static files, and generates
 * `./dist/index.html` for Cloudflare Workers Static Assets & Pages.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const assetsDir = path.join(distDir, 'assets');
const publicDir = path.join(rootDir, 'public');

/**
 * Copies every file inside `public/` into `dist/`.
 */
function copyPublicAssets(): void {
  if (!fs.existsSync(publicDir)) return;
  for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      fs.copyFileSync(
        path.join(publicDir, entry.name),
        path.join(distDir, entry.name)
      );
    }
  }
}

/**
 * Compiles the React SPA into `./dist` using esbuild.
 */
export async function runBuild(): Promise<void> {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/client/main.tsx')],
    bundle: true,
    minify: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    outdir: assetsDir,
    entryNames: '[name]',
    chunkNames: 'chunk-[hash]',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    logLevel: 'info',
  });

  copyPublicAssets();

  const templateHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const distHtml = templateHtml.replace(
    /<script\s+type="module"\s+src="\/src\/client\/main\.tsx"><\/script>/i,
    `<link rel="stylesheet" href="/assets/main.css" />\n    <script type="module" src="/assets/main.js"></script>`
  );

  fs.writeFileSync(path.join(distDir, 'index.html'), distHtml, 'utf8');
  console.log('Built production bundle into ./dist');
}

// Run directly when executed as a CLI script
const isMain = process.argv[1]?.endsWith('build.ts');
if (isMain) {
  runBuild().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
