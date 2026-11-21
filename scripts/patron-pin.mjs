// Sahip paneli (/patron) PIN'ini belirleyen SQL'i yazar.
//   node scripts/patron-pin.mjs 123456 > pin.sql
//   npx wrangler d1 execute guzellik-salonu --remote --file pin.sql
// (sonra pin.sql dosyasını sil)
import { createHash, randomBytes } from 'node:crypto'
const pin = process.argv[2]
if (!/^\d{4,8}$/.test(pin || '')) {
  console.error('PIN 4-8 haneli rakam olmalı')
  process.exit(1)
}
const salt = randomBytes(8).toString('hex')
const hash = `${salt}$${createHash('sha256').update(`${salt}:${pin}`).digest('hex')}`
console.log(`INSERT OR REPLACE INTO secrets (key, hash) VALUES ('platform', '${hash}');`)
console.log(`DELETE FROM sessions WHERE role = 'platform';`)
