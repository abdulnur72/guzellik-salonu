// Tek dosyalık yayının giriş noktası: /api sunucuya, diğer her şey gömülü dosyalara.
import { handle, type Env } from '../server/api'
import files from '../.worker-assets.json'

const F = files as Record<string, { type: string; body: string }>

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/')) return handle(req, env)
    let path = url.pathname
    if (path === '/patron' || path === '/patron/') path = '/patron.html'
    if (path === '/patron.html' && url.pathname === '/patron.html') return Response.redirect(url.origin + '/patron', 301)
    const f = F[path] ?? F['/index.html']
    const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    return new Response(f.body, { headers: { 'content-type': f.type, 'cache-control': cache } })
  },
}
