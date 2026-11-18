// Testler için Cloudflare D1 benzeri arayüz (bun:sqlite üstünde)
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args }
  bind(...a) { return new Stmt(this.db, this.sql, a.map((x) => (x === undefined ? null : x))) }
  async first() { return this.db.query(this.sql).get(...this.args) ?? null }
  async all() { return { results: this.db.query(this.sql).all(...this.args) } }
  async run() { this.db.query(this.sql).run(...this.args); return { success: true } }
  _sync() { return this.db.query(this.sql).all(...this.args) }
}
export function makeDB() {
  const db = new Database(':memory:')
  for (const f of ['test/fixtures/0001_init.sql', 'test/fixtures/0002_patron.sql', 'test/fixtures/0003_hali.sql', 'db/0005_kuafor.sql']) db.exec(readFileSync(f, 'utf8'))
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    async batch(list) { return db.transaction(() => list.map((s) => s._sync()))() },
  }
}
