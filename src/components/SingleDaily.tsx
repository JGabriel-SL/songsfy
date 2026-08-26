import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { dayNumber } from '../lib/daily'
import { dailySingleAnswer, gameSongById, getTrack } from '../lib/catalog-remote'
import { lastDiag } from '../lib/itunes'
import { submitResult } from '../lib/sync'
import { loadDayState, saveDayState, loadStats, recordResult, type Stats } from '../lib/storage'
import { usePreviewPlayer } from '../hooks/usePreviewPlayer'
import { Guessbox } from './Guessbox'
import { Vinyl } from './Vinyl'
import { Equalizer } from './Equalizer'
import { ShareButton } from './ShareButton'
import type { TrackInfo } from '../types'

const CLIPS = [1, 2, 4, 7, 11, 16]
const MAX = 6
const SKIP = '__skip__'

interface DayState {
  guesses: string[]
  status: 'playing' | 'won' | 'lost'
}

function fireConfetti() {
  const colors = ['#ff8c1a', '#ff4d5a', '#ff2e88', '#ffc02e', '#ff6d1f']
  confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 }, colors })
  setTimeout(() => confetti({ particleCount: 80, spread: 100, origin: { y: 0.4 }, colors }), 350)
}

export function SingleDaily() {
  const answer = useMemo(() => dailySingleAnswer(), [])

  const [state, setState] = useState<DayState>(() => loadDayState<DayState>('single') ?? { guesses: [], status: 'playing' })
  const [track, setTrack] = useState<TrackInfo | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [shakeKey, setShakeKey] = useState(0)
  const [stats, setStats] = useState<Stats>(() => loadStats('single'))
  const { play, stop, playing, position } = usePreviewPlayer()
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

  useEffect(() => saveDayState('single', state), [state])

  useEffect(() => {
    if (state.status === 'won' && !celebrated.current) {
      celebrated.current = true
      fireConfetti()
    }
  }, [state.status])

  const attempts = state.guesses.length
  const clipLimit = CLIPS[Math.min(attempts, MAX - 1)]
  const done = state.status !== 'playing'

  const finish = (guesses: string[], won: boolean) => {
    setState({ guesses, status: won ? 'won' : 'lost' })
    setStats(recordResult('single', won, guesses.length))
    stop()
    void submitResult('single', {
      won,
      attempts: guesses.length,
      score: won ? 7 - guesses.length : 0,
      squares: guesses.map((g) => (g === answer.id ? '🟩' : g === SKIP ? '⏭️' : '🟥')).join(''),
    })
  }

  const guess = (songId: string) => {
    if (done) return
    if (songId === answer.id) {
      finish([...state.guesses, songId], true)
      return
    }
    const next = [...state.guesses, songId]
    setShakeKey((k) => k + 1)
    if (next.length >= MAX) finish(next, false)
    else setState({ guesses: next, status: 'playing' })
  }

  // Dicas cumulativas reveladas a cada erro
  const hintCount = done ? 5 : attempts
  const hints = [
    { icon: '🎼', label: 'Gênero', value: answer.genre },
    { icon: '📅', label: 'Lançamento', value: String(answer.year) },
    { icon: '🖼️', label: 'Capa', value: '' },
    { icon: '🔤', label: 'Artista começa com', value: answer.artist[0] },
    { icon: '🎤', label: 'Artista', value: answer.artist },
  ]

  const shareText = () => {
    const squares = state.guesses
      .map((g) => (g === answer.id ? '🟩' : g === SKIP ? '⏭️' : '🟥'))
      .join('')
    const tail = state.status === 'won' ? '' : '❌'
    return `Songsfy 🎧 Música do Dia #${dayNumber()}\n${squares}${tail}\n${state.status === 'won' ? `Acertei em ${attempts}/${MAX}!` : 'Não foi dessa vez…'}`
  }

  if (loadError) {
    return (
      <div className="game">
        <p className="game__error">Não consegui carregar a prévia da música. Verifique sua conexão. 📡</p>
        {lastDiag && <p className="game__diag">{lastDiag}</p>}
        <button type="button" className="btn btn--play" style={{ alignSelf: 'center' }} onClick={() => setRetry((r) => r + 1)}>
          🔄 Tentar de novo
        </button>
      </div>
    )
  }

  return (
    <div className="game">
      <div className="game__stage">
        <Vinyl
          spinning={playing}
          size={200}
          artworkUrl={done || hintCount >= 3 ? track?.artworkUrl : undefined}
          blurred={!done && hintCount >= 3}
        />

        {!done && (
          <>
            <div className="clipbar">
              {CLIPS.map((c, i) => {
                const unlocked = i <= Math.min(attempts, MAX - 1)
                const width = (c / CLIPS[MAX - 1]) * 100
                return (
                  <div key={c} className={`clipbar__seg ${unlocked ? 'clipbar__seg--on' : ''}`} style={{ width: `${width}%` }}>
                    {playing && unlocked && (
                      <div
                        className="clipbar__fill"
                        style={{ width: `${Math.min(100, (Math.min(position, c) / c) * 100)}%` }}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            <button
              type="button"
              className="btn btn--play"
              disabled={!track}
              onClick={() => (playing ? stop() : track && play(track.previewUrl, clipLimit))}
            >
              {!track ? 'Carregando…' : playing ? '◼ Parar' : `▶ Ouvir ${clipLimit}s`}
              <Equalizer active={playing} bars={4} />
            </button>
          </>
        )}
      </div>

      {!done && (
        <>
          <AnimatePresence>
            {hintCount > 0 && (
              <motion.div className="hints" layout>
                {hints.slice(0, hintCount).map((h, i) =>
                  h.label === 'Capa' ? null : (
                    <motion.div
                      key={h.label}
                      className="hints__chip"
                      initial={{ opacity: 0, rotateX: -90 }}
                      animate={{ opacity: 1, rotateX: 0 }}
                      transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      <span>{h.icon}</span> {h.label}: <strong>{h.value}</strong>
                    </motion.div>
                  ),
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
                  className={`attempts__row ${g ? (g === SKIP ? 'attempts__row--skip' : 'attempts__row--wrong') : ''}`}
                  initial={g ? { scale: 0.9, opacity: 0 } : false}
                  animate={{ scale: 1, opacity: 1 }}
                >
                  {g === SKIP ? '⏭️ Pulou' : g ? `❌ ${gameSongById(g)?.title} — ${gameSongById(g)?.artist}` : `Tentativa ${i + 1}`}
                </motion.div>
              )
            })}
          </div>

          <button type="button" className="btn btn--ghost" onClick={() => guess(SKIP)}>
            Pular e liberar mais {attempts < MAX - 1 ? `${CLIPS[attempts + 1] - clipLimit}s` : 'dicas'} ⏭
          </button>
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
              {playing ? '◼ Parar' : '▶ Ouvir prévia completa'}
              <Equalizer active={playing} bars={4} />
            </button>
          )}

          <div className="result__squares">{state.guesses.map((g, i) => <span key={i}>{g === answer.id ? '🟩' : g === SKIP ? '⏭️' : '🟥'}</span>)}</div>

          <ShareButton text={shareText()} />

          <div className="stats">
            <div className="stats__item"><strong>{stats.streak}</strong><span>Sequência</span></div>
            <div className="stats__item"><strong>{stats.maxStreak}</strong><span>Recorde</span></div>
            <div className="stats__item"><strong>{stats.wins}</strong><span>Vitórias</span></div>
            <div className="stats__item"><strong>{stats.played}</strong><span>Jogos</span></div>
          </div>

          <p className="result__comeback">Volte amanhã para uma nova música! 🌅</p>
        </motion.div>
      )}
    </div>
  )
}
