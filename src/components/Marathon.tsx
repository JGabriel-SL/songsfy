import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { createArcadeQueue, type ArcadeRound } from '../lib/arcadeQueue'
import { loadBest, saveBest } from '../lib/storage'
import { submitArcade } from '../lib/sync'
import { usePreviewPlayer } from '../hooks/usePreviewPlayer'
import { Equalizer } from './Equalizer'
import { ShareButton } from './ShareButton'
import { Vinyl } from './Vinyl'

const LIVES = 3
const CLIP_SECONDS = 3

type Phase = 'idle' | 'playing' | 'over'

export function Marathon() {
  const queue = useRef(createArcadeQueue())
  const [phase, setPhase] = useState<Phase>('idle')
  const [round, setRound] = useState<ArcadeRound | null>(null)
  const [loadingRound, setLoadingRound] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [lives, setLives] = useState(LIVES)
  const [score, setScore] = useState(0)
  const [hits, setHits] = useState(0)
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(() => loadBest('marathon'))
  const [wrongPick, setWrongPick] = useState<string | null>(null)
  const [reveal, setReveal] = useState<ArcadeRound | null>(null)
  const [scorePulse, setScorePulse] = useState(0)
  const { play, stop, playing } = usePreviewPlayer()
  const busy = useRef(false)

  useEffect(() => stop, [stop])

  const nextRound = async () => {
    setLoadingRound(true)
    setReveal(null)
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
    setLives(LIVES)
    setScore(0)
    setHits(0)
    setStreak(0)
    setLoadError(false)
    void nextRound()
  }

  const gameOver = (finalScore: number) => {
    stop()
    setPhase('over')
    setBest(saveBest('marathon', finalScore))
    if (finalScore > 0) void submitArcade('marathon', finalScore)
    if (finalScore > 0 && finalScore >= loadBest('marathon')) {
      confetti({ particleCount: 100, spread: 80, origin: { y: 0.5 }, colors: ['#ff8c1a', '#ff4d5a', '#ffc02e'] })
    }
  }

  const pick = (songId: string) => {
    if (!round || busy.current) return
    busy.current = true
    stop()
    if (songId === round.answer.id) {
      const gained = 100 + 25 * streak
      const newScore = score + gained
      setScore(newScore)
      setHits((h) => h + 1)
      setStreak((s) => s + 1)
      setScorePulse((p) => p + 1)
      void nextRound()
      return
    }
    // Errou: perde vida, revela a resposta e segue (ou termina)
    setWrongPick(songId)
    setStreak(0)
    setReveal(round)
    const remaining = lives - 1
    setLives(remaining)
    window.setTimeout(() => {
      if (remaining <= 0) gameOver(score)
      else void nextRound()
    }, 1400)
  }

  return (
    <div className="game">
      {phase === 'idle' && (
        <motion.div className="arcade-intro" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>
          <Vinyl spinning={false} size={150} />
          <h2>Maratona</h2>
          <p>
            Prévias de {CLIP_SECONDS} segundos, 4 opções, <strong>3 vidas</strong>. Acertos em sequência valem bônus. Até
            onde você vai?
          </p>
          {best > 0 && <p className="arcade-intro__best">🏆 Recorde: {best} pts</p>}
          <button type="button" className="btn btn--play" onClick={start}>
            ▶ Começar
          </button>
        </motion.div>
      )}

      {phase === 'playing' && (
        <>
          <div className="hud">
            <div className="hud__lives">
              {Array.from({ length: LIVES }, (_, i) => (
                <motion.span key={i} className="hud__heart" animate={i >= lives ? { scale: [1, 1.4, 0.8], opacity: 0.25 } : {}}>
                  {i < lives ? '❤️' : '🖤'}
                </motion.span>
              ))}
            </div>
            <motion.div
              key={scorePulse}
              className="hud__score"
              initial={scorePulse > 0 ? { scale: 1.35 } : false}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 12 }}
            >
              {score} pts
            </motion.div>
            <div className={`hud__combo ${streak >= 3 ? 'hud__combo--hot' : ''}`}>
              {streak >= 3 ? `🔥 x${streak}` : streak > 0 ? `✦ x${streak}` : ''}
            </div>
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
                <Vinyl spinning={playing} size={120} />
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

              <AnimatePresence>
                {reveal && (
                  <motion.div
                    className="toast toast--fail"
                    initial={{ opacity: 0, y: 20, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    ❌ Era: <strong>{reveal.answer.title}</strong> — {reveal.answer.artist}
                  </motion.div>
                )}
              </AnimatePresence>

              {round && (
                <div className="optgrid optgrid--quad">
                  {round.options.map((o) => (
                    <motion.button
                      key={`${round.answer.id}:${o.id}`}
                      type="button"
                      className={`optcard ${wrongPick === o.id ? 'optcard--wrong' : ''} ${
                        reveal && o.id === reveal.answer.id ? 'optcard--right' : ''
                      }`}
                      disabled={loadingRound || !!reveal}
                      onClick={() => pick(o.id)}
                      initial={{ opacity: 0, y: 18 }}
                      animate={wrongPick === o.id ? { x: [0, -8, 8, -6, 6, 0], opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
                      transition={wrongPick === o.id ? { duration: 0.45 } : { type: 'spring', stiffness: 260, damping: 22 }}
                      whileHover={{ y: -3, scale: 1.02 }}
                      whileTap={{ scale: 0.96 }}
                    >
                      <strong>{o.title}</strong>
                      <span>{o.artist}</span>
                    </motion.button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {phase === 'over' && (
        <motion.div className="result" initial={{ opacity: 0, y: 30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
          <h2 className={`result__title ${score >= best && score > 0 ? 'result__title--win' : ''}`}>
            {score >= best && score > 0 ? 'Novo recorde! 🏆' : 'Fim de jogo! 🎬'}
          </h2>
          <p className="result__song">
            <strong>{score} pts</strong> · {hits} {hits === 1 ? 'acerto' : 'acertos'}
          </p>
          <p className="result__meta">🏆 Recorde: {best} pts</p>
          <ShareButton text={`Songsfy 🏃 Maratona\n🏆 ${score} pts · ${hits} acertos`} />
          <button type="button" className="btn btn--ghost" onClick={start}>
            🔄 Jogar de novo
          </button>
        </motion.div>
      )}
    </div>
  )
}
