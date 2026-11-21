// Tek dosyalık yayın: src/app.html (+ QR) ve sunucu tek dist/_worker.js içine konur.
//   bun install && bun scripts/build.mjs
//
// Sayfadaki kod eski telefonlarda ve WhatsApp/Instagram içindeki tarayıcılarda da çalışsın diye
// "async/await" yazımı burada eski (ES5 + Promise) yazıma çevrilir; kaynak dosya değişmez.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { transformSync } from '@babel/core'
import asyncToPromises from 'babel-plugin-transform-async-to-promises'
import presetEnv from '@babel/preset-env'

const es5 = (code) => transformSync(code, { babelrc: false, configFile: false, compact: false, sourceType: 'script', plugins: [[asyncToPromises, { inlineHelpers: true }]], presets: [[presetEnv, { targets: 'ie 11', modules: false }]] }).code

const qr = readFileSync('src/qr.js', 'utf8').replace(/^if \(typeof module.*$/m, '')
const html = readFileSync('src/app.html', 'utf8')
  .replace('/*__QR__*/', () => qr)
  .replace(/<script>([\s\S]*?)<\/script>/g, (all, code) => (/\basync\b/.test(code) ? `<script>\n${es5(code)}\n</script>` : all))
mkdirSync('build', { recursive: true })
writeFileSync('build/app.html', html)
writeFileSync('build/entry.js', `import { makeWorker } from '../src/server.js'\nexport default makeWorker(${JSON.stringify(html)})\n`)
const r = await Bun.build({ entrypoints: ['build/entry.js'], outdir: 'dist', naming: '_worker.js', target: 'browser', format: 'esm', minify: true })
if (!r.success) {
  console.error(r.logs)
  process.exit(1)
}
console.log('dist/_worker.js hazır:', Math.round(readFileSync('dist/_worker.js').length / 1024), 'KB')
