// Tek dosyalık yayın: src/app.html (+ QR) ve sunucu tek dist/_worker.js içine konur.
//   bun scripts/build.mjs  (kuafor/ klasöründe)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const qr = readFileSync('src/qr.js', 'utf8').replace(/^if \(typeof module.*$/m, '')
const html = readFileSync('src/app.html', 'utf8').replace('/*__QR__*/', () => qr)
mkdirSync('build', { recursive: true })
writeFileSync('build/entry.js', `import { makeWorker } from '../src/server.js'\nexport default makeWorker(${JSON.stringify(html)})\n`)
const r = await Bun.build({ entrypoints: ['build/entry.js'], outdir: 'dist', naming: '_worker.js', target: 'browser', format: 'esm', minify: true })
if (!r.success) {
  console.error(r.logs)
  process.exit(1)
}
console.log('dist/_worker.js hazır:', Math.round(readFileSync('dist/_worker.js').length / 1024), 'KB', '· sayfa', Math.round(html.length / 1024), 'KB')
