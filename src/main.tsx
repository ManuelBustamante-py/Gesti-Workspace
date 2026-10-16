import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Tras publicar una versión nueva, los archivos de la anterior desaparecen y
// una pestaña abierta no puede descargar las páginas que aún no visitó: se
// recarga para tomar la versión nueva (como mucho una vez por minuto, para no
// entrar en un ciclo si el problema es otro, como la falta de conexión).
window.addEventListener('vite:preloadError', (event) => {
  const key = 'gesti:preload-reload'
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
