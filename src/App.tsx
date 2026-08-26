import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Home } from './components/Home'
import { SingleDaily } from './components/SingleDaily'
import { SetDaily } from './components/SetDaily'
import { CoverDaily } from './components/CoverDaily'
import { Marathon } from './components/Marathon'
import { Blitz } from './components/Blitz'
import { Account } from './components/Account'
import { Rankings } from './components/Rankings'
import { Equalizer } from './components/Equalizer'
import { AuthProvider } from './lib/auth'
import { initRemoteData } from './lib/catalog-remote'
import { flushQueue } from './lib/sync'

export type Screen = 'home' | 'single' | 'set' | 'cover' | 'marathon' | 'blitz' | 'account' | 'rankings'

const TITLES: Record<Screen, string> = {
  home: '',
  single: '🎧 Música do Dia',
  set: '🔥 Músicas do Dia',
  cover: '🖼️ Capa do Dia',
  marathon: '🏃 Maratona',
  blitz: '⚡ Relâmpago',
  account: '👤 Conta',
  rankings: '🏆 Ranking',
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
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
              {screen === 'account' && <Account />}
              {screen === 'rankings' && <Rankings />}
            </motion.main>
          </>
        )}
      </div>
    </AuthProvider>
  )
}
