// icons/*.png dosyalarını sunucuya gömülecek src/icons.js'e çevirir (site tek _worker.js'ten çalışır).
//   bun scripts/icons-to-js.mjs
import { readFileSync, writeFileSync } from 'node:fs'
const names = ['icon-192.png', 'icon-512.png', 'icon-192-maskable.png', 'icon-512-maskable.png']
const lines = names.map((n) => `  '/${n}': '${readFileSync('icons/' + n).toString('base64')}',`)
writeFileSync('src/icons.js', `// scripts/icons-to-js.mjs tarafından üretildi, elle düzenlemeyin.\nexport const PNG_ICONS = {\n${lines.join('\n')}\n}\n`)
console.log('src/icons.js hazır')
