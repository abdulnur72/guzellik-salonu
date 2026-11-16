import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useDb } from './core/data/demoStore'
import { applyTheme, sector } from './sectors'
import { BookingPage } from './pages/BookingPage'
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
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/subeler" element={<HomePage list />} />
        <Route path="/sahip" element={<OwnerPage />} />
        <Route path="/s/:slug" element={<PanelPage />} />
        <Route path="/r/:slug" element={<BookingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
