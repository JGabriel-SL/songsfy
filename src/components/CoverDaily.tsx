import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { dayNumber } from '../lib/daily'
import { dailyCoverAnswer, gameSongById, getTrack } from '../lib/catalog-remote'
import { lastDiag } from '../lib/itunes'
import { submitResult } from '../lib/sync'
import { loadDayState, saveDayState, loadStats, recordResult, type Stats } from '../lib/storage'
import { usePreviewPlayer } from '../hooks/usePreviewPlayer'
import { Equalizer } from './Equalizer'
import { Guessbox } from './Guessbox'
import { ShareButton } from './ShareButton'
import type { TrackInfo } from '../types'

const MAX = 6
// Desfoque da capa por tentativa (índice = nº de erros)
const BLURS = [28, 18, 11, 6, 3, 1]

interface DayState {
  guesses: string[]
  status: 'playing' | 'won' | 'lost'
}

export function CoverDaily() {
  const answer = useMemo(() => dailyCoverAnswer(), [])

  const [state, setState] = useState<DayState>(() => loadDayState<DayState>('cover') ?? { guesses: [], status: 'playing' })
  const [track, setTrack] = useState<TrackInfo | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [shakeKey, setShakeKey] = useState(0)
  const [stats, setStats] = useState<Stats>(() => loadStats('cover'))
  const { play, stop, playing } = usePreviewPlayer()
  const celebrated = useRef(false)

  useEffect(() => {
    let alive = true
    setLoadError(false)
    getTrack(answer)
      .then((t) => {
        if (!alive) return
        if (t) setTrack(t)
        else setLoadError(true)
      })
      .catch(() => alive && setLoadError(true))
    return () => {
      alive = false
    }
  }, [answer, retry])

  useEffect(() => saveDayState('cover', state), [state])

  useEffect(() => {
    if (state.status === 'won' && !celebrated.current) {
      celebrated.current = true
      confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 }, colors: ['#ff8c1a', '#ff4d5a', '#ff2e88', '#ffc02e'] })
    }
  }, [state.status])

  const attempts = state.guesses.length
  const done = state.status !== 'playing'
  const blur = done ? 0 : BLURS[Math.min(attempts, MAX - 1)]

  const finish = (guesses: string[], won: boolean) => {
    setState({ guesses, status: won ? 'won' : 'lost' })
    setStats(recordResult('cover', won, guesses.length))
    void submitResult('cover', {
      won,
      attempts: guesses.length,
      score: won ? 7 - guesses.length : 0,
      squares: guesses.map((g) => (g === answer.id ? '🟩' : '🟥')).join(''),
    })
  }

  const guess = (songId: string) => {
    if (done) return
    const next = [...state.guesses, songId]
    if (songId === answer.id) {
      finish(next, true)
      return
    }
    setShakeKey((k) => k + 1)
    if (next.length >= MAX) finish(next, false)
    else setState({ guesses: next, status: 'playing' })
  }

  const shareText = () => {
    const squares = state.guesses.map((g) => (g === answer.id ? '🟩' : '🟥')).join('')
    return `Songsfy 🖼️ Capa do Dia #${dayNumber()}\n${squares}${state.status === 'lost' ? '❌' : ''}\n${
      state.status === 'won' ? `Acertei em ${attempts}/${MAX}!` : 'Não foi dessa vez…'
    }`
  }

  if (loadError) {
    return (
      <div className="game">
        <p className="game__error">Não consegui carregar a capa do álbum. Verifique sua conexão. 📡</p>
        {lastDiag && <p className="game__diag">{lastDiag}</p>}
        <button type="button" className="btn btn--play" style={{ alignSelf: 'center' }} onClick={() => setRetry((r) => r + 1)}>
          🔄 Tentar de novo
        </button>
      </div>
    )
  }

  return (
    <div className="game">
      <div className="coverframe">
        {track ? (
          <motion.img
            src={track.artworkUrl}
            alt="Capa do álbum"
            className="coverframe__img"
            initial={false}
            animate={{ filter: `blur(${blur}px) saturate(1.25)`, scale: done ? 1 : 1.06 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            draggable={false}
          />
        ) : (
          <div className="coverframe__loading">
            <Equalizer active bars={5} />
          </div>
        )}
        {!done && <div className="coverframe__counter">{attempts}/{MAX}</div>}
      </div>

      {!done && (
        <>
          <p className="game__help">
            De quem é essa capa? A imagem fica mais nítida a cada erro — <strong>{MAX - attempts}</strong>{' '}
            {MAX - attempts === 1 ? 'tentativa restante' : 'tentativas restantes'}.
          </p>

          <AnimatePresence>
            {(attempts >= 2 || attempts >= 4) && (
              <motion.div className="hints" layout>
                {attempts >= 2 && (
                  <motion.div className="hints__chip" initial={{ opacity: 0, rotateX: -90 }} animate={{ opacity: 1, rotateX: 0 }}>
                    <span>📅</span> Lançamento: <strong>{answer.year}</strong>
                  </motion.div>
                )}
                {attempts >= 4 && (
                  <motion.div className="hints__chip" initial={{ opacity: 0, rotateX: -90 }} animate={{ opacity: 1, rotateX: 0 }}>
                    <span>🎼</span> Gênero: <strong>{answer.genre}</strong>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <Guessbox exclude={state.guesses} onGuess={guess} shakeKey={shakeKey} />

          <div className="attempts">
            {Array.from({ length: MAX }, (_, i) => {
              const g = state.guesses[i]
              return (
                <motion.div
                  key={i}
                  className={`attempts__row ${g ? 'attempts__row--wrong' : ''}`}
                  initial={g ? { scale: 0.9, opacity: 0 } : false}
                  animate={{ scale: 1, opacity: 1 }}
                >
                  {g ? `❌ ${gameSongById(g)?.title} — ${gameSongById(g)?.artist}` : `Tentativa ${i + 1}`}
                </motion.div>
              )
            })}
          </div>
        </>
      )}

      {done && (
        <motion.div className="result" initial={{ opacity: 0, y: 30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
          <h2 className={`result__title ${state.status === 'won' ? 'result__title--win' : ''}`}>
            {state.status === 'won' ? `Acertou em ${attempts}/${MAX}! 🎉` : 'Não foi dessa vez… 😅'}
          </h2>
          <p className="result__song">
            <strong>{answer.title}</strong> — {answer.artist}
          </p>
          <p className="result__meta">
            {answer.genre} · {answer.year} {track?.album ? `· ${track.album}` : ''}
          </p>

          {track && (
            <button type="button" className="btn btn--play" onClick={() => (playing ? stop() : play(track.previewUrl))}>
              {playing ? '◼ Parar' : '▶ Ouvir prévia'}
              <Equalizer active={playing} bars={4} />
            </button>
          )}

          <div className="result__squares">{state.guesses.map((g, i) => <span key={i}>{g === answer.id ? '🟩' : '🟥'}</span>)}</div>

          <ShareButton text={shareText()} />

          <div className="stats">
            <div className="stats__item"><strong>{stats.streak}</strong><span>Sequência</span></div>
            <div className="stats__item"><strong>{stats.maxStreak}</strong><span>Recorde</span></div>
            <div className="stats__item"><strong>{stats.wins}</strong><span>Vitórias</span></div>
            <div className="stats__item"><strong>{stats.played}</strong><span>Jogos</span></div>
          </div>

          <p className="result__comeback">Volte amanhã para uma nova capa! 🌅</p>
        </motion.div>
      )}
    </div>
  )
}
