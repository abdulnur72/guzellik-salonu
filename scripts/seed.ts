// Boş veritabanına örnek salonu yükleyen SQL'i üretir.
//   npx tsx scripts/seed.ts --owner-pin 123456 --manager-pin 654321 > seed.sql
//   npx wrangler d1 execute guzellik-salonu --remote --file seed.sql
// Veritabanında işletme zaten varsa SQL hata verir, hiçbir şey değişmez.
// Çok dükkânlı yapı (0007_coklu_salon.sql uygulanmış olmalı): her satır salona
// bağlanır (rows.biz = işletme kimliği), sahip PIN'i salona özel anahtarla
// (owner:<işletme>) yazılır. Eski tek işletmeli kod için 'owner' anahtarı da yazılır.

import { seedDemo } from '../src/core/data/demoStore'
import { toRows } from '../src/core/data/rows'
import { hashPin, ixOf } from '../server/api'

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const ownerPin = arg('--owner-pin')
const managerPin = arg('--manager-pin')
if (!ownerPin || !managerPin || !/^\d{4,8}$/.test(ownerPin) || !/^\d{4,8}$/.test(managerPin)) {
  console.error('Kullanım: npx tsx scripts/seed.ts --owner-pin 123456 --manager-pin 654321')
  process.exit(1)
}

const db = seedDemo()
// Örnek salon bilgileri (gerçek salonla değiştirilecek)
db.business.ownerName = 'Salon Sahibi'
const main = db.branches[0]
main.branch.address = 'Örnek Mah. Lale Sok. No: 1, Kadıköy / İstanbul'
main.branch.phone = '0212 000 00 00'
main.branch.hours = 'Pazartesi–Cumartesi 09:00–20:00, Pazar kapalı'
main.staff.push({ id: crypto.randomUUID(), branchId: main.branch.id, name: 'Zeynep', role: 'reception', commissionPct: 0, active: true })

const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const biz = db.business.id
const lines: string[] = ["UPDATE meta SET v = v + 1 WHERE k = 'seq';"]
for (const r of toRows(db).values()) {
  const data = { ...r.data }
  if (r.kind === 'business') data.ownerPin = '•'
  if (r.kind === 'branch') data.managerPin = '•'
  lines.push(
    `INSERT INTO rows (kind, id, branch_id, ix, data, seq, deleted, biz) VALUES (${q(r.kind)}, ${q(r.id)}, ${q(r.branchId)}, ${q(ixOf(r.kind, data))}, ${q(JSON.stringify(data))}, (SELECT v FROM meta WHERE k = 'seq'), 0, ${q(biz)});`,
  )
}
const ownerHash = await hashPin(ownerPin)
lines.push(`INSERT INTO secrets (key, hash) VALUES (${q('owner:' + biz)}, ${q(ownerHash)});`)
lines.push(`INSERT INTO secrets (key, hash) VALUES ('owner', ${q(ownerHash)});`)
lines.push(`INSERT INTO secrets (key, hash) VALUES ('manager:${main.branch.id}', ${q(await hashPin(managerPin))});`)
console.log(lines.join('\n'))
