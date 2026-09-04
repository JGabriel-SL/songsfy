// Sino da barra de topo: contador de não lidos e o histórico de avisos.
// Cada linha guarda a URL que o push usaria — clicar aqui leva ao mesmo lugar,
// só que sem recarregar a página (menos no convite de batalha, que precisa do
// ?room=CODE na URL para a sala ser encontrada na abertura).

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { KIND_EMOJI, notificationTarget, timeAgo, useNotifications, type AppNotification } from '../lib/notifications'
import type { Screen } from '../lib/screens'

export function NotificationBell({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const { items, unreadCount, markRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Fecha ao tocar fora ou apertar Esc — comportamento de menu, não de tela
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openNotification = (n: AppNotification) => {
    void markRead(n.id)
    setOpen(false)
    const target = notificationTarget(n.url)
    if ('screen' in target) onNavigate(target.screen)
    else window.location.assign(target.href)
  }

  return (
    <div className="bell" ref={wrapRef}>
      <button
        type="button"
        className={`bell__btn ${open ? 'bell__btn--on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Avisos (${unreadCount} não lidos)` : 'Avisos'}
        aria-expanded={open}
      >
        🔔
        {unreadCount > 0 && <span className="bell__badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="bell__panel"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
          >
            <div className="bell__head">
              <strong>Avisos</strong>
              {unreadCount > 0 && (
                <button type="button" className="bell__markall" onClick={() => void markRead()}>
                  Marcar tudo como lido
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="bell__empty">Nada por aqui ainda. Pedidos de amizade, convites de batalha e recordes dos amigos aparecem nesta lista.</p>
            ) : (
              <ul className="bell__list">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`bell__item ${n.read_at ? '' : 'bell__item--unread'}`}
                      onClick={() => openNotification(n)}
                    >
                      <span className="bell__emoji" aria-hidden="true">
                        {KIND_EMOJI[n.kind] ?? '🔔'}
                      </span>
                      <span className="bell__text">
                        <strong>{n.title}</strong>
                        <span>{n.body}</span>
                        <em>{timeAgo(n.created_at)}</em>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
