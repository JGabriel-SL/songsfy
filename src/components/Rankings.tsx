import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CATEGORIES } from '../data/catalog'
import { todayKey } from '../lib/daily'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Board = 'single' | 'cover' | 'set' | 'marathon' | 'blitz'

interface DailyRow {
  user_id: string
  nickname: string | null
  avatar_emoji: string
  won: boolean
  attempts: number | null
  score: number | null
  squares: string | null
}

interface ArcadeRow {
  user_id: string
  nickname: string | null
  avatar_emoji: string
  best_score: number
}

const BOARDS: { id: Board; label: string }[] = [
  { id: 'single', label: '🎧 Música' },
  { id: 'cover', label: '🖼️ Capa' },
  { id: 'set', label: '🔥 Músicas' },
  { id: 'marathon', label: '🏃 Maratona' },
  { id: 'blitz', label: '⚡ Relâmpago' },
]

export function Rankings() {
  const auth = useAuth()
  const [board, setBoard] = useState<Board>('single')
  const [category, setCategory] = useState(CATEGORIES[0].id)
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([])
  const [arcadeRows, setArcadeRows] = useState<ArcadeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const isArcade = board === 'marathon' || board === 'blitz'
  const mode = board === 'set' ? `set:${category}` : board

  useEffect(() => {
    if (!supabase) return
    let alive = true
    setLoading(true)
    setError(false)

    const query = isArcade
      ? supabase.from('arcade_leaderboard').select('*').eq('mode', board).order('best_score', { ascending: false }).limit(50)
      : supabase.from('daily_leaderboard').select('*').eq('date', todayKey()).eq('mode', mode).limit(200)

    query
      .then(({ data, error: err }) => {
        if (!alive) return
        setLoading(false)
        if (err || !data) {
          setError(true)
          return
        }
        if (isArcade) setArcadeRows(data as ArcadeRow[])
        else setDailyRows(data as DailyRow[])
      })
    return () => {
      alive = false
    }
  }, [board, mode, isArcade])

  // Ordenação do diário: vitórias primeiro; single/cover por menos tentativas, set por mais acertos
  const sortedDaily = useMemo(() => {
    const rows = [...dailyRows]
    if (board === 'set') rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    else rows.sort((a, b) => Number(b.won) - Number(a.won) || (a.attempts ?? 99) - (b.attempts ?? 99))
    return rows.slice(0, 50)
  }, [dailyRows, board])

  if (!auth.online) {
    return (
      <div className="game">
        <p className="game__error">
          Rankings fazem parte do modo online — configure o Supabase (seção "Ativando o modo online" do README). 🔌
        </p>
      </div>
    )
  }

  const myId = auth.user?.id
  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`)

  return (
    <div className="game">
      <div className="cats">
        {BOARDS.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`cats__tab ${board === b.id ? 'cats__tab--on' : ''}`}
            onClick={() => setBoard(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      {board === 'set' && (
        <div className="cats">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`cats__tab ${category === c.id ? 'cats__tab--on' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      )}

      {!isArcade && <p className="game__help">Desafio de hoje · {todayKey()}</p>}

      {loading ? (
        <p className="game__error">Carregando ranking…</p>
      ) : error ? (
        <p className="game__error">Não consegui carregar o ranking. 📡</p>
      ) : (
        <ul className="lb">
          {(isArcade ? arcadeRows : sortedDaily).length === 0 && (
            <p className="game__error">Ninguém pontuou ainda — seja a primeira pessoa! 🚀</p>
          )}
          {isArcade
            ? arcadeRows.map((r, i) => (
                <motion.li
                  key={r.user_id}
                  className={`lb__row ${r.user_id === myId ? 'lb__row--me' : ''}`}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.04 }}
                >
                  <span className="lb__pos">{medal(i)}</span>
                  <span className="lb__avatar">{r.avatar_emoji}</span>
                  <span className="lb__nick">{r.nickname ?? 'Anônimo'}</span>
                  <span className="lb__value">
                    {r.best_score} {board === 'marathon' ? 'pts' : 'acertos'}
                  </span>
                </motion.li>
              ))
            : sortedDaily.map((r, i) => (
                <motion.li
                  key={r.user_id}
                  className={`lb__row ${r.user_id === myId ? 'lb__row--me' : ''}`}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.04 }}
                >
                  <span className="lb__pos">{medal(i)}</span>
                  <span className="lb__avatar">{r.avatar_emoji}</span>
                  <span className="lb__nick">{r.nickname ?? 'Anônimo'}</span>
                  <span className="lb__squares">{r.squares}</span>
                  <span className="lb__value">
                    {board === 'set' ? `${r.score ?? 0}/6` : r.won ? `${r.attempts}/6` : '❌'}
                  </span>
                </motion.li>
              ))}
        </ul>
      )}

      {!auth.user && <p className="game__help">Entre com uma conta para aparecer aqui! 🏆</p>}
    </div>
  )
}
