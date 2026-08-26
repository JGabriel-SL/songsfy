import { useCallback, useEffect, useRef, useState } from 'react'

// Toca a prévia de 30s limitando a duração do trecho (estilo Heardle).
export function usePreviewPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const limitRef = useRef<number>(Infinity)
  const rafRef = useRef<number>(0)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    audioRef.current = audio
    const onEnded = () => setPlaying(false)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onEnded)
    return () => {
      cancelAnimationFrame(rafRef.current)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onEnded)
      audio.pause()
      audio.src = ''
    }
  }, [])

  const tick = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    setPosition(audio.currentTime)
    if (audio.currentTime >= limitRef.current) {
      audio.pause()
      setPlaying(false)
      return
    }
    if (!audio.paused) rafRef.current = requestAnimationFrame(tick)
  }, [])

  /** Toca `src` do início até `limitSeconds` (ou até o fim da prévia). */
  const play = useCallback(
    (src: string, limitSeconds = Infinity) => {
      const audio = audioRef.current
      if (!audio) return
      cancelAnimationFrame(rafRef.current)
      if (audio.src !== src) audio.src = src
      audio.currentTime = 0
      limitRef.current = limitSeconds
      setPosition(0)
      void audio
        .play()
        .then(() => {
          setPlaying(true)
          rafRef.current = requestAnimationFrame(tick)
        })
        .catch(() => setPlaying(false))
    },
    [tick],
  )

  const stop = useCallback(() => {
    audioRef.current?.pause()
    cancelAnimationFrame(rafRef.current)
    setPlaying(false)
  }, [])

  return { play, stop, playing, position }
}
