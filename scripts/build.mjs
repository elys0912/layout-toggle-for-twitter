// dist/ に、そのまま Firefox に読み込める拡張を作る。
//
// 束ねるもの（esbuild、ファイルごとに 1 つの IIFE。圧縮しない）：
//   src/content.ts -> dist/content.js（manifest の content script）
//   src/options.ts -> dist/options.js（options.html から読む）
// 写すもの：src/manifest.json・_locales/・icons/・LICENSE・src/options.html・src/options.css
//
// esbuild は型を見ない。型は `npm run typecheck`（tsc --noEmit）で確かめ、`npm run build` はそれを先に実行する。
// 束ねた JS は機械が作ったコードの扱いになるので、AMO への提出にはソースの zip を付ける。
//
// 使い方: node scripts/build.mjs

import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const COPIED_PATHS = [
  ['src/manifest.json', 'manifest.json'],
  ['_locales', '_locales'],
  ['icons', 'icons'],
  ['LICENSE', 'LICENSE'],
  ['src/options.html', 'options.html'],
  ['src/options.css', 'options.css'],
];

rmSync(dist, { recursive: true, force: true });

await build({
  entryPoints: {
    content: path.join(root, 'src', 'content.ts'),
    options: path.join(root, 'src', 'options.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  // manifest の strict_min_version（Firefox 140）に合わせる
  target: 'firefox140',
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
});

for (const [from, to] of COPIED_PATHS) {
  cpSync(path.join(root, from), path.join(dist, to), { recursive: true });
}

console.log(`built ${path.relative(root, dist)}/`);
