// Tek dosyalık yayın: src/app.html (+ QR) ve sunucu tek dist/_worker.js içine konur.
// Sayfanın betiği ve stili küçültülür (zayıf mobil veride hızlı açılsın).
//   bun scripts/build.mjs  (spor/ klasöründe)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

mkdirSync('build', { recursive: true })
const qr = readFileSync('src/qr.js', 'utf8').replace(/^if \(typeof module.*$/m, '')
let html = readFileSync('src/app.html', 'utf8')
// QR ve uygulama betiği tek betikte birleşip küçültülür
const m = html.match(/<script>\n\/\*__QR__\*\/\n<\/script>\n<script>\n([\s\S]*?)<\/script>/)
if (!m) throw new Error('betik bulunamadı')
writeFileSync('build/page.js', qr + '\n;(function(){\n' + m[1] + '\n})();\n')
const pb = await Bun.build({ entrypoints: ['build/page.js'], outdir: 'build', naming: 'page.min.js', target: 'browser', minify: true })
if (!pb.success) {
  console.error(pb.logs)
  process.exit(1)
}
const js = readFileSync('build/page.min.js', 'utf8').trim()
html = html.replace(m[0], () => '<script>' + js.replace(/<\/script/gi, '<\\/script') + '</script>')
html = html.replace(/<style>([\s\S]*?)<\/style>/, (_, css) => '<style>' + css.replace(/\n+/g, '').replace(/\s*([{};,>])\s*/g, '$1') + '</style>')
html = html.replace(/>\n+</g, '><')
writeFileSync('build/app.html', html)
writeFileSync('build/entry.js', `import { makeWorker } from '../src/server.js'\nexport default makeWorker(${JSON.stringify(html)})\n`)
const r = await Bun.build({ entrypoints: ['build/entry.js'], outdir: 'dist', naming: '_worker.js', target: 'browser', format: 'esm', minify: true })
if (!r.success) {
  console.error(r.logs)
  process.exit(1)
}
const gz = Bun.gzipSync(new TextEncoder().encode(html)).length
console.log('dist/_worker.js hazır:', Math.round(readFileSync('dist/_worker.js').length / 1024), 'KB', '· sayfa', Math.round(html.length / 1024), 'KB (sıkıştırılmış ~' + Math.round(gz / 1024) + ' KB)')
