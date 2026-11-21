// Tek dosyalık yayın: dist/ içindeki bütün dosyalar ve sunucu tek bir
// _worker.js içine konur (Cloudflare Pages "advanced mode").
//   npm run build && node scripts/build-worker.mjs
//   npx wrangler pages deploy dist-worker --branch main
import { build } from 'esbuild'
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' }
const files = {}
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f)
  if (statSync(p).isDirectory()) return walk(p)
  const rel = '/' + relative('dist', p)
  if (rel === '/_redirects') return
  files[rel] = { type: TYPES[extname(p)] || 'application/octet-stream', body: readFileSync(p, 'utf8') }
})
walk('dist')
mkdirSync('dist-worker', { recursive: true })
writeFileSync('.worker-assets.json', JSON.stringify(files))
await build({
  entryPoints: ['scripts/worker-entry.ts'],
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', minify: true,
  outfile: 'dist-worker/_worker.js', loader: { '.json': 'json' },
})
console.log('dist-worker/_worker.js hazır,', Object.keys(files).length, 'dosya')
