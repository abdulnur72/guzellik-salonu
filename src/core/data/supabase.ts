// Supabase istemcisi. Hesap açılıp .env doldurulunca kullanılmaya başlanacak.
// Şimdilik yalnızca istemciyi oluşturur; demoStore'daki işlemlerin Supabase
// karşılıkları bir sonraki adımda buraya yazılacak (bkz. README > Yol haritası).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isDemo, SUPABASE_ANON_KEY, SUPABASE_URL } from './mode'

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient | null {
  if (isDemo) return null
  client ??= createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)
  return client
}
