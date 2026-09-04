// Casca fixa do app: barra de topo (voltar · título · sino · perfil) e barra de
// abas embaixo. As duas ficam presas na tela — o conteúdo rola por baixo — para que o
// PWA instalado se pareça com um app de verdade, e não com um site rolando inteiro.

import { useAuth } from '../lib/auth'
import { useFriends } from '../lib/friends'
import { TITLES, type Screen } from '../lib/screens'
import { NotificationBell } from './NotificationBell'

interface ShellProps {
  screen: Screen
  onNavigate: (screen: Screen) => void
}

export function AppBar({ screen, onNavigate }: ShellProps) {
  const auth = useAuth()
  const isHome = screen === 'home'
  const name = auth.user ? (auth.profile?.nickname ?? 'Perfil') : 'Entrar'
  const avatar = auth.user ? (auth.profile?.avatar_emoji ?? '👤') : '👤'

  return (
    <header className="appbar">
      <div className="appbar__inner">
        {isHome ? (
          <span className="appbar__mark" aria-hidden="true">
            🎵
          </span>
        ) : (
          <button type="button" className="appbar__back" onClick={() => onNavigate('home')} aria-label="Voltar">
            ←
          </button>
        )}

        <h1 className={`appbar__title ${isHome ? 'appbar__title--brand' : ''}`}>{TITLES[screen]}</h1>

        {auth.user && <NotificationBell onNavigate={onNavigate} />}

        <button
          type="button"
          className={`appbar__profile ${screen === 'account' ? 'appbar__profile--on' : ''}`}
          onClick={() => onNavigate('account')}
          aria-label={auth.user ? `Perfil de ${name}` : 'Entrar na conta'}
        >
          <span className="appbar__avatar" aria-hidden="true">
            {avatar}
          </span>
          <span className="appbar__name">{name}</span>
        </button>
      </div>
    </header>
  )
}

const TABS: { id: Screen; icon: string; label: string }[] = [
  { id: 'home', icon: '🏠', label: 'Início' },
  { id: 'rankings', icon: '🏆', label: 'Ranking' },
  { id: 'friends', icon: '👥', label: 'Amigos' },
  { id: 'account', icon: '👤', label: 'Perfil' },
]

export function TabBar({ screen, onNavigate }: ShellProps) {
  const { pendingCount } = useFriends()

  return (
    <nav className="tabbar" aria-label="Navegação principal">
      <div className="tabbar__inner">
        {TABS.map((tab) => {
          const active = screen === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              className={`tabbar__item ${active ? 'tabbar__item--on' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(tab.id)}
            >
              <span className="tabbar__icon" aria-hidden="true">
                {tab.icon}
              </span>
              <span className="tabbar__label">{tab.label}</span>
              {tab.id === 'friends' && pendingCount > 0 && <span className="tabbar__badge">{pendingCount}</span>}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
