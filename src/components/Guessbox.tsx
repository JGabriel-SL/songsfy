import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { gameCatalog } from '../lib/catalog-remote'

interface GuessboxProps {
  /** Ids de músicas que não devem aparecer nas sugestões (já chutadas). */
  exclude: string[]
  onGuess: (songId: string) => void
  /** Incrementado a cada erro para disparar a animação de shake. */
  shakeKey: number
}

export function Guessbox({ exclude, onGuess, shakeKey }: GuessboxProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return gameCatalog().filter(
      (s) => !exclude.includes(s.id) && (s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)),
    ).slice(0, 7)
  }, [query, exclude])

  const pick = (songId: string) => {
    setQuery('')
    onGuess(songId)
  }

  return (
    <motion.div
      className="guessbox"
      key={shakeKey}
      animate={shakeKey > 0 ? { x: [0, -10, 10, -7, 7, 0] } : {}}
      transition={{ duration: 0.4 }}
    >
      <input
        type="text"
        className="guessbox__input"
        placeholder="Digite o nome da música ou artista…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      <AnimatePresence>
        {filtered.length > 0 && (
          <motion.ul className="guessbox__list" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            {filtered.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => pick(s.id)}>
                  <strong>{s.title}</strong> <span>· {s.artist}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
