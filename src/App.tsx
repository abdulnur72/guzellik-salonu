import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useDb } from './core/data/demoStore'
import { setLock, useLock } from './core/data/lock'
import { isDemo } from './core/data/mode'
import { api } from './core/data/remote'
import { applyTheme, sector } from './sectors'
import { BookingPage } from './pages/BookingPage'
import { LockScreen } from './pages/LockScreen'
import { HomePage } from './pages/HomePage'
import { OwnerPage } from './pages/OwnerPage'
import { PanelPage } from './pages/PanelPage'

export function App() {
  const db = useDb()
  useEffect(() => {
    applyTheme(sector(db.business.sector))
    document.title = db.business.name
  }, [db.business.sector, db.business.name])
  return (
    <BrowserRouter>
      <div className="pole" />
      <Locked>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/subeler" element={<HomePage list />} />
        <Route path="/sahip" element={<OwnerPage />} />
        <Route path="/sahip/:kod" element={<OwnerPage />} />
        <Route path="/s/:slug" element={<PanelPage />} />
        <Route path="/r/:slug" element={<BookingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Locked>
    </BrowserRouter>
  )
}

/**
 * Aboneliği biten dükkânda sayfa yerine "Abonelik sona erdi" ekranı.
 * Panel açılırken şubenin durumu ayrıca sorulur (sahip oturumuyla açılan
 * şube paneli de kapansın diye).
 */
function Locked({ children }: { children: React.ReactNode }) {
  const lock = useLock()
  const { pathname } = useLocation()
  const slug = pathname.match(/^\/s\/([^/]+)/)?.[1]
  const [checked, setChecked] = useState<string | undefined>()
  useEffect(() => {
    if (isDemo || !slug || checked === slug) return
    setChecked(slug)
    api(`/api/public/b/${encodeURIComponent(slug)}`).catch(() => undefined)
  }, [slug, checked])
  // Başka sayfaya geçince (ör. kilitli şubeden açık olana) kilit yeniden sorulsun
  useEffect(() => setLock(null), [pathname])
  return lock ? <LockScreen info={lock} /> : <>{children}</>
}
