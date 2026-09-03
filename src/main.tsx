import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Atalho de teste: abrir a URL com "?reset" zera o progresso dos desafios do dia
// (mantém estatísticas e recordes). Ex.: https://meuapp.com/?reset
if (new URLSearchParams(location.search).has('reset')) {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('songsfy:day:'))
    .forEach((k) => localStorage.removeItem(k))
  history.replaceState(null, '', location.pathname)
}

// O Safari do iOS ignora `user-scalable=no`: bloquear os eventos de pinça é o que
// impede o zoom lá. Duplo-toque e pinça no Android já param no `touch-action` do CSS.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
