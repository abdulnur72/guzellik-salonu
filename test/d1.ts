// Testler için Cloudflare D1 benzeri arayüz (bun:sqlite üstünde, bellekte).
// Canlı ya da Cloudflare'deki hiçbir veritabanına bağlanmaz.
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIG = join(import.meta.dir, '..', 'db', 'migrations')
export const MIGRATIONS = ['0001_init.sql', '0002_patron.sql', '0003_hali.sql', '0004_berber.sql', '0005_kuafor.sql', '0006_spor.sql', '0007_coklu_salon.sql']

class Stmt {
  constructor(
    private db: Database,
    private sql: string,
    private args: unknown[] = [],
  ) {}
  bind(...a: unknown[]) {
    return new Stmt(this.db, this.sql, a.map((x) => (x === undefined ? null : x)))
  }
  async first() {
    return (this.db.query(this.sql).get(...(this.args as never[])) as unknown) ?? null
  }
  async all() {
    return { results: this.db.query(this.sql).all(...(this.args as never[])) }
  }
  async run() {
    this.db.query(this.sql).run(...(this.args as never[]))
    return { success: true }
  }
  sync() {
    return { results: this.db.query(this.sql).all(...(this.args as never[])) }
  }
}

/** upTo: bu dosyaya kadar (dahil) uygula; verilmezse hepsi */
export function makeDB(upTo?: string) {
  const db = new Database(':memory:')
  for (const f of MIGRATIONS) {
    db.exec(readFileSync(join(MIG, f), 'utf8'))
    if (f === upTo) break
  }
  return {
    raw: db,
    migrate(file: string) {
      db.exec(readFileSync(join(MIG, file), 'utf8'))
    },
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(list: Stmt[]) {
      return db.transaction(() => list.map((s) => s.sync()))()
    },
  }
}
