// Abonelik kilidi: sunucu 402 "subscription_ended" dönünce bütün uygulama
// "Abonelik sona erdi" ekranına geçer. Kayıtlar silinmez; ödeme alınınca
// ekran kendiliğinden (ya da "Tekrar dene" ile) açılır.

import { useSyncExternalStore } from 'react'

export interface LockInfo {
  ad: string
  wa: string
}

let current: LockInfo | null = null
const subs = new Set<() => void>()

export function setLock(info: LockInfo | null) {
  current = info
  subs.forEach((f) => f())
}

export function useLock() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => void subs.delete(f)
    },
    () => current,
  )
}
