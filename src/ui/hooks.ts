import { useEffect, useState } from 'react'
import type { Branch, Business } from '../core/types'
import { businessToday, money, zonedParts } from '../core/time'

/** İş gününü ve şu anki dakikayı verir; dakikada bir yenilenir (gece açık kalan sayfa için). */
export function useClock(business: Business, branch: Pick<Branch, 'dayCutoffHour'> | undefined) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const z = zonedParts(now, business.timeZone)
  return {
    today: businessToday(now, business.timeZone, branch?.dayCutoffHour ?? 0),
    calendarToday: z.date,
    nowMin: z.minutes,
  }
}

export function useMoney(business: Business) {
  return (n: number) => money(n, business.locale, business.currency)
}
