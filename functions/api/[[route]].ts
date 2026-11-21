// Cloudflare Pages Functions: /api/* isteklerini sunucu koduna yollar.
import { handle, type Env } from '../../server/api'

export const onRequest: PagesFunction<Env> = (ctx) => handle(ctx.request, ctx.env)
