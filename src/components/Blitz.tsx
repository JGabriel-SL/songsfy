import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { createArcadeQueue, type ArcadeRound } from '../lib/arcadeQueue'
import { loadBest, saveBest } from '../lib/storage'
import { submitArcade } from '../lib/sync'
import { usePreviewPlayer } from '../hooks/usePreviewPlayer'
import { Equalizer } from './Equalizer'
import { ShareButton } from './ShareButton'

const START_SECONDS = 60
const BONUS_SECONDS = 2
const CLIP_SECONDS = 2

type Phase = 'idle' | 'playing' | 'over'

export function Blitz() {
  const queue = useRef(createArcadeQueue())
  const [phase, setPhase] = useState<Phase>('idle')
  const [round, setRound] = useState<ArcadeRound | null>(null)
  const [loadingRound, setLoadingRound] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(() => loadBest('blitz'))
  const [timeLeft, setTimeLeft] = useState(START_SECONDS)
  const [wrongPick, setWrongPick] = useState<string | null>(null)
  const [bonusFlash, setBonusFlash] = useState(0)
  const { play, stop, playing } = usePreviewPlayer()
  const deadline = useRef(0)
  const rafId = useRef(0)
  const scoreRef = useRef(0)
  const busy = useRef(false)

  useEffect(
    () => () => {
      cancelAnimationFrame(rafId.current)
      stop()
    },
    [stop],
  )

  const finish = () => {
    cancelAnimationFrame(rafId.current)
    stop()
    setPhase('over')
    const final = scoreRef.current
    const newBest = saveBest('blitz', final)
    setBest(newBest)
    if (final > 0) void submitArcade('blitz', final)
    if (final > 0 && final >= newBest) {
      confetti({ particleCount: 100, spread: 80, origin: { y: 0.5 }, colors: ['#ff8c1a', '#ff4d5a', '#ffc02e'] })
    }
  }

  const tick = () => {
    const left = (deadline.current - performance.now()) / 1000
    if (left <= 0) {
      setTimeLeft(0)
      finish()
      return
    }
    setTimeLeft(left)
    rafId.current = requestAnimationFrame(tick)
  }

  const nextRound = async () => {
    setLoadingRound(true)
    setWrongPick(null)
    const r = await queue.current.next()
    setLoadingRound(false)
    if (!r) {
      setLoadError(true)
      return
    }
    setRound(r)
    play(r.track.previewUrl, CLIP_SECONDS)
    busy.current = false
  }

  const start = () => {
    setPhase('playing')
    setScore(0)
    scoreRef.current = 0
    setLoadError(false)
    deadline.current = performance.now() + START_SECONDS * 1000
    setTimeLeft(START_SECONDS)
    cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(tick)
    void nextRound()
  }

  const pick = (songId: string) => {
    if (!round || busy.current) return
    busy.current = true
    if (songId === round.answer.id) {
      scoreRef.current += 1
      setScore(scoreRef.current)
      deadline.current += BONUS_SECONDS * 1000
      setBonusFlash((b) => b + 1)
    } else {
      setWrongPick(songId)
    }
    void nextRound()
  }

  const skip = () => {
    if (busy.current) return
    busy.current = true
    void nextRound()
  }

  const urgent = timeLeft <= 10

  return (
    <div className="game">
      {phase === 'idle' && (
        <motion.div className="arcade-intro" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>
          <span className="arcade-intro__emoji">⚡</span>
          <h2>Relâmpago</h2>
          <p>
            <strong>{START_SECONDS} segundos</strong> no relógio. Trechos de {CLIP_SECONDS}s, 4 opções — cada acerto vale{' '}
            <strong>+{BONUS_SECONDS}s</strong>. Quantas você reconhece?
          </p>
          {best > 0 && <p className="arcade-intro__best">🏆 Recorde: {best} acertos</p>}
          <button type="button" className="btn btn--play" onClick={start}>
            ▶ Começar
          </button>
        </motion.div>
      )}

      {phase === 'playing' && (
        <>
          <div className="hud">
            <motion.div
              key={bonusFlash}
              className={`hud__timer ${urgent ? 'hud__timer--urgent' : ''}`}
              initial={bonusFlash > 0 ? { scale: 1.25, color: '#3ddc84' } : false}
              animate={{ scale: 1 }}
            >
              ⏱ {Math.ceil(timeLeft)}s
            </motion.div>
            <div className="hud__score">{score} {score === 1 ? 'acerto' : 'acertos'}</div>
          </div>

          <div className={`timerbar ${urgent ? 'timerbar--urgent' : ''}`}>
            <div className="timerbar__fill" style={{ width: `${Math.min(100, (timeLeft / START_SECONDS) * 100)}%` }} />
          </div>

          {loadError ? (
            <>
              <p className="game__error">Não consegui carregar as prévias. Verifique sua conexão. 📡</p>
              <button
                type="button"
                className="btn btn--play"
                style={{ alignSelf: 'center' }}
                onClick={() => {
                  setLoadError(false)
                  void nextRound()
                }}
              >
                🔄 Tentar de novo
              </button>
            </>
          ) : (
            <>
              <div className="game__stage game__stage--compact">
                <button
                  type="button"
                  className="btn btn--play"
                  disabled={loadingRound || !round}
                  onClick={() => (playing ? stop() : round && play(round.track.previewUrl, CLIP_SECONDS))}
                >
                  {loadingRound ? 'Carregando…' : playing ? '◼ Parar' : '▶ Reouvir'}
                  <Equalizer active={playing} bars={4} />
                </button>
              </div>

              {round && (
                <div className="optgrid optgrid--quad">
                  {round.options.map((o) => (
                    <motion.button
                      key={`${round.answer.id}:${o.id}`}
                      type="button"
                      className={`optcard ${wrongPick === o.id ? 'optcard--wrong' : ''}`}
                      disabled={loadingRound}
                      onClick={() => pick(o.id)}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                      whileTap={{ scale: 0.96 }}
                    >
                      <strong>{o.title}</strong>
                      <span>{o.artist}</span>
                    </motion.button>
                  ))}
                </div>
              )}

              <button type="button" className="btn btn--ghost" onClick={skip} disabled={loadingRound}>
                Pular ⏭
              </button>
            </>
          )}
        </>
      )}

      {phase === 'over' && (
        <motion.div className="result" initial={{ opacity: 0, y: 30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
          <h2 className={`result__title ${score >= best && score > 0 ? 'result__title--win' : ''}`}>
            {score >= best && score > 0 ? 'Novo recorde! 🏆' : 'Tempo esgotado! ⏱'}
          </h2>
          <p className="result__song">
            <strong>{score}</strong> {score === 1 ? 'acerto' : 'acertos'} em {START_SECONDS}s (+bônus)
          </p>
          <p className="result__meta">🏆 Recorde: {best} acertos</p>
          <ShareButton text={`Songsfy ⚡ Relâmpago\n🏆 ${score} acertos contra o relógio`} />
          <button type="button" className="btn btn--ghost" onClick={start}>
            🔄 Jogar de novo
          </button>
        </motion.div>
      )}

    </div>
  )
}
