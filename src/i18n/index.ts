import { tr, type MessageKey } from './tr'

const messages: Record<MessageKey, string> = tr

/** Yazıyı getirir, {ad} gibi yer tutucuları doldurur. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const s = messages[key] ?? key
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s
}

export type { MessageKey }
