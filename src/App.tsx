import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Home } from './components/Home'
import { SingleDaily } from './components/SingleDaily'
import { SetDaily } from './components/SetDaily'
import { CoverDaily } from './components/CoverDaily'
import { Marathon } from './components/Marathon'
import { Blitz } from './components/Blitz'
import { Battle } from './components/Battle'
import { Account } from './components/Account'
import { Rankings } from './components/Rankings'
import { Friends } from './components/Friends'
import { Equalizer } from './components/Equalizer'
import { AuthProvider } from './lib/auth'
import { FriendsProvider, useFriends } from './lib/friends'
import { initRemoteData } from './lib/catalog-remote'
import { flushQueue } from './lib/sync'

export type Screen = 'home' | 'single' | 'set' | 'cover' | 'marathon' | 'blitz' | 'battle' | 'account' | 'rankings' | 'friends'

const TITLES: Record<Screen, string> = {
  home: '',
  single: '🎧 Música do Dia',
  set: '🔥 Músicas do Dia',
  cover: '🖼️ Capa do Dia',
  marathon: '🏃 Maratona',
  blitz: '⚡ Relâmpago',
  battle: '⚔️ Batalha',
  account: '👤 Conta',
  rankings: '🏆 Ranking',
  friends: '👥 Amigos',
}

// Tela inicial a partir da URL: ?room=CODE (convite de Batalha), ?friend=CODE (convite de
// amigo) ou ?screen=friends (clique numa notificação). O parâmetro `screen` é consumido aqui.
function initialScreen(): Screen {
  const url = new URL(window.location.href)
  if (url.searchParams.has('room')) return 'battle'
  if (url.searchParams.has('friend')) return 'friends'
  const screen = url.searchParams.get('screen')
  if (screen) {
    url.searchParams.delete('screen')
    window.history.replaceState({}, '', url.toString())
    if (screen in TITLES) return screen as Screen
  }
  return 'home'
}

// Aviso flutuante de amizade (novo pedido / pedido aceito), alimentado pelo FriendsProvider
function FriendToast({ onOpen }: { onOpen: () => void }) {
  const { toast, dismissToast } = useFriends()
  if (!toast) return null
  return (
    <motion.button
      type="button"
      key={toast.id}
      className="toast toast--global"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => {
        dismissToast()
        onOpen()
      }}
    >
      {toast.text} <span className="toast__cta">{toast.kind === 'request' ? 'Ver pedido →' : 'Ver placar →'}</span>
    </motion.button>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    initRemoteData().finally(() => {
      if (alive) setReady(true)
      void flushQueue()
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <AuthProvider>
      <FriendsProvider>
      <div className="app">
        <div className="bg-blobs" aria-hidden="true">
          <div className="blob blob--1" />
          <div className="blob blob--2" />
          <div className="blob blob--3" />
        </div>

        {!ready ? (
          <div className="splash">
            <Equalizer active bars={5} />
            <p>Afinando os instrumentos…</p>
          </div>
        ) : (
          <>
            {screen !== 'home' && (
              <header className="topbar">
                <button type="button" className="topbar__back" onClick={() => setScreen('home')} aria-label="Voltar">
                  ←
                </button>
                <h1 className="topbar__title">{TITLES[screen]}</h1>
              </header>
            )}

            <motion.main
              key={screen}
              className="screen"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              {screen === 'home' && <Home onNavigate={setScreen} />}
              {screen === 'single' && <SingleDaily />}
              {screen === 'set' && <SetDaily />}
              {screen === 'cover' && <CoverDaily />}
              {screen === 'marathon' && <Marathon />}
              {screen === 'blitz' && <Blitz />}
              {screen === 'battle' && <Battle />}
              {screen === 'account' && <Account />}
              {screen === 'rankings' && <Rankings onNavigate={setScreen} />}
              {screen === 'friends' && <Friends />}
            </motion.main>
            <FriendToast onOpen={() => setScreen('friends')} />
          </>
        )}
      </div>
      </FriendsProvider>
    </AuthProvider>
  )
}
