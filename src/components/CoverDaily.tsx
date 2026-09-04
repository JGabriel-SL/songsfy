import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { dailyRng, dayNumber, seededShuffle } from '../lib/daily'
import { dailyCoverAnswer, dailyCoverDecoys, getAlbumTrack } from '../lib/catalog-remote'
import { albumKey, lastDiag } from '../lib/itunes'
import { submitResult } from '../lib/sync'
import { loadDayLock, loadDayState, saveDayState, loadStats, recordResult, type Stats } from '../lib/storage'
import { DailyLocked } from './DailyLocked'
import { Equalizer } from './Equalizer'
import { ShareButton } from './ShareButton'
import type { StoryData } from '../lib/storyImage'
import type { TrackInfo } from '../types'

const MAX = 6
const OPTIONS = 9
// Iscas buscadas: sobra para descartar as que não resolvem álbum ou repetem o mesmo nome
const DECOYS = 13
const BATCH = 4
// Desfoque da capa por tentativa (índice = nº de erros)
const BLURS = [28, 18, 11, 6, 3, 1]

interface AlbumOption {
  album: string
  artist: string
}

interface DayState {
  /** Nomes dos álbuns já chutados, na ordem */
  guesses: string[]
  status: 'playing' | 'won' | 'lost'
}

export function CoverDaily() {
  const answer = useMemo(() => dailyCoverAnswer(), [])
  const decoys = useMemo(() => dailyCoverDecoys(answer, DECOYS), [answer])

  const [state, setState] = useState<DayState>(
    () => loadDayState<DayState>('cover-album') ?? { guesses: [], status: 'playing' },
  )
  const lock = useMemo(() => loadDayLock('cover-album'), [])
  const [track, setTrack] = useState<TrackInfo | null>(null)
  const [options, setOptions] = useState<AlbumOption[]>([])
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [wrongPick, setWrongPick] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats>(() => loadStats('cover'))
  const celebrated = useRef(false)

  // Capa da resposta + nomes de álbum das iscas, que formam as opções de palpite
  useEffect(() => {
    let alive = true
    setLoadError(false)
    const build = async () => {
      const main = await getAlbumTrack(answer)
      if (!alive) return
      if (!main?.artworkUrl || !main.album) {
        setLoadError(true)
        return
      }
      setTrack(main)

      const seen = new Set([albumKey(main.album)])
      const opts: AlbumOption[] = [{ album: main.album, artist: answer.artist }]
      // Em lotes e só até completar a grade: quando o catálogo não vem do banco, cada
      // isca custa uma busca na iTunes — uma rajada de 13 esbarraria no rate limit.
      for (let i = 0; i < decoys.length && opts.length < OPTIONS; i += BATCH) {
        const batch = await Promise.all(
          decoys.slice(i, i + BATCH).map((s) =>
            getAlbumTrack(s)
              .then((info) => ({ song: s, info }))
              .catch(() => ({ song: s, info: null as TrackInfo | null })),
          ),
        )
        if (!alive) return
        for (const { song, info } of batch) {
          if (opts.length >= OPTIONS) break
          if (!info?.album || seen.has(albumKey(info.album))) continue
          seen.add(albumKey(info.album))
          opts.push({ album: info.album, artist: song.artist })
        }
      }
      setOptions(seededShuffle(opts, dailyRng('cover:grid')))
    }
    build().catch(() => alive && setLoadError(true))
    return () => {
      alive = false
    }
  }, [answer, decoys, retry])

  useEffect(() => saveDayState('cover-album', state), [state])

  useEffect(() => {
    if (state.status === 'won' && !celebrated.current) {
      celebrated.current = true
      confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 }, colors: ['#ff8c1a', '#ff4d5a', '#ff2e88', '#ffc02e'] })
    }
  }, [state.status])

  const attempts = state.guesses.length
  const done = state.status !== 'playing'
  const blur = done ? 0 : BLURS[Math.min(attempts, MAX - 1)]
  const correct = (album: string) => !!track && albumKey(album) === albumKey(track.album)

  const finish = (guesses: string[], won: boolean) => {
    setState({ guesses, status: won ? 'won' : 'lost' })
    setStats(recordResult('cover', won, guesses.length))
    void submitResult('cover', {
      won,
      attempts: guesses.length,
      score: won ? 7 - guesses.length : 0,
      squares: guesses.map((g) => (correct(g) ? '🟩' : '🟥')).join(''),
    })
  }

  const guess = (album: string) => {
    if (done || wrongPick) return
    const next = [...state.guesses, album]
    if (correct(album)) {
      finish(next, true)
      return
    }
    setWrongPick(album)
    window.setTimeout(() => setWrongPick(null), 650)
    if (next.length >= MAX) finish(next, false)
    else setState({ guesses: next, status: 'playing' })
  }

  const shareText = () => {
    const squares = state.guesses.map((g) => (correct(g) ? '🟩' : '🟥')).join('')
    return `Songsfy 🖼️ Capa do Dia #${dayNumber()}\n${squares}${state.status === 'lost' ? '❌' : ''}\n${
      state.status === 'won' ? `Acertei em ${attempts}/${MAX}!` : 'Não foi dessa vez…'
    }`
  }

  const storyData = (): StoryData => ({
    mode: 'Capa do Dia',
    emoji: '🖼️',
    day: dayNumber(),
    cells: state.guesses.map((g) => (correct(g) ? 'ok' : 'bad')),
    headline: state.status === 'won' ? `Acertei em ${attempts}/${MAX}!` : 'Não foi dessa vez…',
    stats: [
      { label: 'Sequência', value: stats.streak },
      { label: 'Recorde', value: stats.maxStreak },
      { label: 'Vitórias', value: stats.wins },
      { label: 'Jogos', value: stats.played },
    ],
  })

  // Resultado do dia já está na conta, mas o progresso não veio para este aparelho
  if (lock && state.status === 'playing') {
    return (
      <div className="game">
        <DailyLocked label="Capa do Dia" lock={lock} />
      </div>
    )
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
            De qual álbum é essa capa? A imagem fica mais nítida a cada erro — <strong>{MAX - attempts}</strong>{' '}
            {MAX - attempts === 1 ? 'tentativa restante' : 'tentativas restantes'}.
          </p>

          <AnimatePresence>
            {attempts >= 2 && (
              <motion.div className="hints" layout>
                <motion.div className="hints__chip" initial={{ opacity: 0, rotateX: -90 }} animate={{ opacity: 1, rotateX: 0 }}>
                  <span>📅</span> Lançamento: <strong>{answer.year}</strong>
                </motion.div>
                {attempts >= 4 && (
                  <motion.div className="hints__chip" initial={{ opacity: 0, rotateX: -90 }} animate={{ opacity: 1, rotateX: 0 }}>
                    <span>🎼</span> Gênero: <strong>{answer.genre}</strong>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {options.length === 0 ? (
            <p className="game__help">Carregando os álbuns…</p>
          ) : (
            <div className="optgrid">
              {options.map((o, i) => {
                const used = state.guesses.some((g) => albumKey(g) === albumKey(o.album))
                return (
                  <motion.button
                    key={o.album}
                    type="button"
                    className={`optcard ${used ? 'optcard--used' : ''} ${wrongPick === o.album ? 'optcard--wrong' : ''}`}
                    disabled={used}
                    onClick={() => guess(o.album)}
                    initial={{ opacity: 0, y: 24 }}
                    animate={wrongPick === o.album ? { x: [0, -8, 8, -6, 6, 0], opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
                    transition={
                      wrongPick === o.album ? { duration: 0.45 } : { delay: i * 0.05, type: 'spring', stiffness: 260, damping: 22 }
                    }
                    whileHover={used ? {} : { y: -4, scale: 1.03 }}
                    whileTap={used ? {} : { scale: 0.96 }}
                  >
                    <strong>{o.album}</strong>
                    <span>{o.artist}</span>
                  </motion.button>
                )
              })}
            </div>
          )}

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
                  {g ? `❌ ${g}` : `Tentativa ${i + 1}`}
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
            <strong>{track?.album}</strong> — {answer.artist}
          </p>
          <p className="result__meta">
            {answer.genre} · {answer.year}
          </p>

          <div className="result__squares">{state.guesses.map((g, i) => <span key={i}>{correct(g) ? '🟩' : '🟥'}</span>)}</div>

          <ShareButton text={shareText()} story={storyData()} />

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
