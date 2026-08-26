import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { CATEGORIES } from '../data/catalog'
import { dayNumber } from '../lib/daily'
import { dailySetPuzzle, getTrack } from '../lib/catalog-remote'
import { lastDiag } from '../lib/itunes'
import { submitResult } from '../lib/sync'
import { loadDayState, saveDayState } from '../lib/storage'
import { usePreviewPlayer } from '../hooks/usePreviewPlayer'
import { Equalizer } from './Equalizer'
import { ShareButton } from './ShareButton'
import type { CategoryId, Song, TrackInfo } from '../types'

const TRACKS = 6
const MAX_TRACK_ERRORS = 2

interface TrackResult {
  status: 'pending' | 'ok' | 'fail'
  errors: number
}

interface SetState {
  tracks: TrackResult[]
}

function freshState(): SetState {
  return { tracks: Array.from({ length: TRACKS }, () => ({ status: 'pending' as const, errors: 0 })) }
}

function loadValidState(key: string): SetState {
  const loaded = loadDayState<SetState>(key)
  if (loaded && Array.isArray(loaded.tracks) && loaded.tracks.length === TRACKS) return loaded
  return freshState()
}

export function SetDaily() {
  const [category, setCategory] = useState<CategoryId>('pop')
  const { targets, options } = useMemo(() => dailySetPuzzle(category), [category])
  const stateKey = `set:${category}`

  const [state, setState] = useState<SetState>(() => loadValidState(stateKey))
  const [active, setActive] = useState(0)
  const [tracks, setTracks] = useState<Map<string, TrackInfo>>(new Map())
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [wrongPick, setWrongPick] = useState<string | null>(null)
  const [lastReveal, setLastReveal] = useState<{ ok: boolean; song: Song } | null>(null)
  const { play, stop, playing } = usePreviewPlayer()
  const [playingIdx, setPlayingIdx] = useState<number | null>(null)
  const revealTimer = useRef<number>(0)
  const submitted = useRef<Set<string>>(new Set())

  // Troca de categoria: recarrega o estado salvo daquela categoria
  useEffect(() => {
    const s = loadValidState(`set:${category}`)
    setState(s)
    setActive(Math.max(0, s.tracks.findIndex((t) => t.status === 'pending')))
    setWrongPick(null)
    setLastReveal(null)
    stop()
    setPlayingIdx(null)
    // jogo já terminado antes desta sessão: não reenvia o resultado
    if (s.tracks.every((t) => t.status !== 'pending')) submitted.current.add(category)
  }, [category, stop])

  useEffect(() => saveDayState(stateKey, state), [stateKey, state])

  useEffect(() => {
    if (!playing) setPlayingIdx(null)
  }, [playing])

  useEffect(() => {
    let alive = true
    setLoadError(false)
    // Busca as 9 opções (as 6 respostas estão entre elas): prévia para tocar + capa para os cards.
    // Falhas pontuais (rajada de 9 chamadas) ganham uma segunda tentativa automática.
    const fetchAll = async () => {
      const map = new Map<string, TrackInfo>()
      const load = async (songs: typeof options) => {
        const pairs = await Promise.all(songs.map((t) => getTrack(t).then((info) => [t.id, info] as const)))
        for (const [id, info] of pairs) if (info) map.set(id, info)
      }
      await load(options)
      const missing = options.filter((o) => !map.has(o.id))
      if (missing.length > 0 && alive) {
        await new Promise((r) => setTimeout(r, 1500))
        await load(missing)
      }
      if (!alive) return
      setTracks(map)
      // Sem prévia de nenhuma resposta = não dá para jogar
      if (!targets.some((t) => map.has(t.id))) setLoadError(true)
    }
    fetchAll().catch(() => alive && setLoadError(true))
    return () => {
      alive = false
    }
  }, [options, targets, retry])

  const done = state.tracks.every((t) => t.status !== 'pending')
  const score = state.tracks.filter((t) => t.status === 'ok').length

  // Envia o resultado ao ranking quando o jogo termina nesta sessão
  useEffect(() => {
    if (!done || submitted.current.has(category)) return
    submitted.current.add(category)
    void submitResult(`set:${category}`, {
      won: score === TRACKS,
      attempts: null,
      score,
      squares: state.tracks.map((t) => (t.status === 'ok' ? '🟩' : '🟥')).join(''),
    })
  }, [done, category, score, state.tracks])

  // Opções consumidas = respostas das faixas já resolvidas (acertadas ou reveladas)
  const consumed = useMemo(
    () => new Set(targets.filter((_, i) => state.tracks[i].status !== 'pending').map((t) => t.id)),
    [targets, state.tracks],
  )

  const toggleTrack = (i: number) => {
    if (state.tracks[i].status === 'pending') setActive(i)
    const info = tracks.get(targets[i].id)
    if (!info) return
    if (playingIdx === i) {
      stop()
      setPlayingIdx(null)
    } else {
      play(info.previewUrl)
      setPlayingIdx(i)
    }
  }

  const resolve = (idx: number, ok: boolean) => {
    setLastReveal({ ok, song: targets[idx] })
    if (ok) {
      confetti({ particleCount: 45, spread: 60, origin: { y: 0.65 }, colors: ['#ff8c1a', '#ff4d5a', '#ffc02e'] })
    }
    window.clearTimeout(revealTimer.current)
    revealTimer.current = window.setTimeout(() => setLastReveal(null), 2200)
    setState((s) => {
      const next = s.tracks.map((t, i) => (i === idx ? { ...t, status: ok ? ('ok' as const) : ('fail' as const) } : t))
      // Ativa a próxima faixa pendente
      const nextPending = next.findIndex((t) => t.status === 'pending')
      if (nextPending >= 0) setActive(nextPending)
      return { tracks: next }
    })
  }

  const pick = (song: Song) => {
    if (done || wrongPick || state.tracks[active].status !== 'pending') return
    if (song.id === targets[active].id) {
      resolve(active, true)
      return
    }
    setWrongPick(song.id)
    window.setTimeout(() => setWrongPick(null), 650)
    const errs = state.tracks[active].errors + 1
    if (errs >= MAX_TRACK_ERRORS) {
      const idx = active
      window.setTimeout(() => resolve(idx, false), 700)
    } else {
      setState((s) => ({ tracks: s.tracks.map((t, i) => (i === active ? { ...t, errors: errs } : t)) }))
    }
  }

  const shareText = () => {
    const cat = CATEGORIES.find((c) => c.id === category)
    const squares = state.tracks.map((t) => (t.status === 'ok' ? '🟩' : '🟥')).join('')
    return `Songsfy 🔥 Músicas do Dia · ${cat?.label} #${dayNumber()}\n${squares} ${score}/${TRACKS}`
  }

  return (
    <div className="game">
      <div className="cats">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`cats__tab ${c.id === category ? 'cats__tab--on' : ''}`}
            onClick={() => setCategory(c.id)}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      {loadError ? (
        <>
          <p className="game__error">Não consegui carregar as prévias. Verifique sua conexão. 📡</p>
          {lastDiag && <p className="game__diag">{lastDiag}</p>}
          <button type="button" className="btn btn--play" style={{ alignSelf: 'center' }} onClick={() => setRetry((r) => r + 1)}>
            🔄 Tentar de novo
          </button>
        </>
      ) : done ? (
        <motion.div className="result" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
          <h2 className={`result__title ${score >= 4 ? 'result__title--win' : ''}`}>
            {score === TRACKS ? 'Perfeito! 🏆' : score >= 4 ? 'Mandou bem! 🎉' : 'Dia difícil… 😅'} {score}/{TRACKS}
          </h2>
          <div className="result__squares">{state.tracks.map((t, i) => <span key={i}>{t.status === 'ok' ? '🟩' : '🟥'}</span>)}</div>

          <ul className="tracklist">
            {targets.map((t, i) => {
              const info = tracks.get(t.id)
              return (
                <motion.li key={t.id} className="tracklist__item" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}>
                  {info?.artworkUrl ? <img src={info.artworkUrl} alt="" /> : <span className="tracklist__ph">♪</span>}
                  <div>
                    <strong>{t.title}</strong>
                    <span>{t.artist}</span>
                  </div>
                  <button
                    type="button"
                    className="tracklist__play"
                    disabled={!info}
                    onClick={() => info && play(info.previewUrl)}
                    aria-label={`Ouvir ${t.title}`}
                  >
                    ▶
                  </button>
                  <span className="tracklist__mark">{state.tracks[i].status === 'ok' ? '✅' : '❌'}</span>
                </motion.li>
              )
            })}
          </ul>

          <ShareButton text={shareText()} />
          <p className="result__comeback">Amanhã tem mais 6! 🌅</p>
        </motion.div>
      ) : (
        <>
          <p className="game__help">
            Ouça as faixas na ordem que quiser e escolha a resposta entre as 9 opções. Acertos: <strong>{score}</strong> · Restam:{' '}
            <strong>{state.tracks.filter((t) => t.status === 'pending').length}</strong>
          </p>

          <div className="trackpick">
            {state.tracks.map((t, i) => {
              const resolved = t.status !== 'pending'
              const info = tracks.get(targets[i].id)
              return (
                <motion.button
                  key={i}
                  type="button"
                  className={`trackpick__card ${i === active && !resolved ? 'trackpick__card--active' : ''} ${
                    t.status === 'ok' ? 'trackpick__card--ok' : t.status === 'fail' ? 'trackpick__card--fail' : ''
                  }`}
                  onClick={() => toggleTrack(i)}
                  disabled={!info}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, type: 'spring', stiffness: 260, damping: 22 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <span className="trackpick__icon">
                    {t.status === 'ok' ? '✅' : t.status === 'fail' ? '❌' : playingIdx === i ? '◼' : '▶'}
                  </span>
                  <span className="trackpick__name">Faixa {i + 1}</span>
                  {playingIdx === i ? (
                    <Equalizer active bars={4} />
                  ) : (
                    <span className="trackpick__hint">
                      {resolved ? targets[i].title : t.errors > 0 ? '⚠️ 1 erro' : !info ? '…' : 'ouvir'}
                    </span>
                  )}
                </motion.button>
              )
            })}
          </div>

          {!done && state.tracks[active]?.status === 'pending' && (
            <p className="game__prompt">
              Palpite para a <strong>Faixa {active + 1}</strong>
              {state.tracks[active].errors > 0 && <span className="game__lives"> · ⚠️ mais um erro e ela é revelada!</span>}
            </p>
          )}

          <AnimatePresence>
            {lastReveal && (
              <motion.div
                className={`toast ${lastReveal.ok ? 'toast--ok' : 'toast--fail'}`}
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {lastReveal.ok ? '✅ Acertou!' : '❌ Era:'} <strong>{lastReveal.song.title}</strong> — {lastReveal.song.artist}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="optgrid">
            {options.map((o, i) => {
              const used = consumed.has(o.id)
              const art = tracks.get(o.id)?.artworkUrl
              return (
                <motion.button
                  key={o.id}
                  type="button"
                  className={`optcard ${used ? 'optcard--used' : ''} ${wrongPick === o.id ? 'optcard--wrong' : ''}`}
                  disabled={used}
                  onClick={() => pick(o)}
                  initial={{ opacity: 0, y: 24 }}
                  animate={wrongPick === o.id ? { x: [0, -8, 8, -6, 6, 0], opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
                  transition={wrongPick === o.id ? { duration: 0.45 } : { delay: i * 0.05, type: 'spring', stiffness: 260, damping: 22 }}
                  whileHover={used ? {} : { y: -4, scale: 1.03 }}
                  whileTap={used ? {} : { scale: 0.96 }}
                >
                  {art ? (
                    <img className="optcard__art" src={art} alt="" loading="lazy" draggable={false} />
                  ) : (
                    <span className="optcard__art optcard__art--ph">♪</span>
                  )}
                  <strong>{o.title}</strong>
                  <span>{o.artist}</span>
                </motion.button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
