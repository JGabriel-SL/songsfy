import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CATEGORIES } from '../data/catalog'
import { todayKey } from '../lib/daily'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useFriends, weekStartKey } from '../lib/friends'
import type { Screen } from '../App'

type Board = 'single' | 'cover' | 'set' | 'marathon' | 'blitz'
type Scope = 'global' | 'friends'
type Period = 'today' | 'week'

interface DailyRow {
  user_id: string
  nickname: string | null
  avatar_emoji: string
  won: boolean
  attempts: number | null
  score: number | null
  squares: string | null
}

interface WeekRow {
  user_id: string
  nickname: string | null
  avatar_emoji: string
  points: number
  days_played: number
  avg_attempts: number | null
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

interface Props {
  onNavigate?: (screen: Screen) => void
}

export function Rankings({ onNavigate }: Props) {
  const auth = useAuth()
  const { friendIds } = useFriends()
  const [board, setBoard] = useState<Board>('single')
  const [scope, setScope] = useState<Scope>('global')
  const [period, setPeriod] = useState<Period>('today')
  const [category, setCategory] = useState(CATEGORIES[0].id)
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([])
  const [weekRows, setWeekRows] = useState<WeekRow[]>([])
  const [arcadeRows, setArcadeRows] = useState<ArcadeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const isArcade = board === 'marathon' || board === 'blitz'
  const isWeek = !isArcade && period === 'week'
  const mode = board === 'set' ? `set:${category}` : board
  const myId = auth.user?.id

  // Em "Amigos" a lista inclui você, para se ver no meio deles
  const scopeIds = useMemo(() => (scope === 'friends' ? [...friendIds, ...(myId ? [myId] : [])] : null), [scope, friendIds, myId])
  const scopeKey = scopeIds?.join(',') ?? ''

  useEffect(() => {
    if (!supabase) return
    if (scope === 'friends' && !myId) return
    let alive = true
    setLoading(true)
    setError(false)

    let query
    if (isArcade) {
      query = supabase.from('arcade_leaderboard').select('*').eq('mode', board).order('best_score', { ascending: false }).limit(50)
    } else if (isWeek) {
      query = supabase
        .from('weekly_mode_points')
        .select('*')
        .eq('mode', mode)
        .eq('week_start', weekStartKey())
        .order('points', { ascending: false })
        .order('days_played', { ascending: false })
        .order('avg_attempts', { ascending: true, nullsFirst: false })
        .limit(50)
    } else {
      query = supabase.from('daily_leaderboard').select('*').eq('date', todayKey()).eq('mode', mode).limit(200)
    }
    if (scopeIds) query = query.in('user_id', scopeIds)

    query.then(({ data, error: err }) => {
      if (!alive) return
      setLoading(false)
      if (err || !data) {
        setError(true)
        return
      }
      if (isArcade) setArcadeRows(data as ArcadeRow[])
      else if (isWeek) setWeekRows(data as WeekRow[])
      else setDailyRows(data as DailyRow[])
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, mode, isArcade, isWeek, scopeKey, myId])

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

  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`)
  const rowAnim = (i: number) => ({
    initial: { opacity: 0, x: -16 },
    animate: { opacity: 1, x: 0 },
    transition: { delay: Math.min(i, 10) * 0.04 },
  })

  const count = isArcade ? arcadeRows.length : isWeek ? weekRows.length : sortedDaily.length
  const friendsScopeEmpty = scope === 'friends' && (!myId || friendIds.length === 0)

  return (
    <div className="game">
      <div className="cats">
        <button type="button" className={`cats__tab ${scope === 'global' ? 'cats__tab--on' : ''}`} onClick={() => setScope('global')}>
          🌍 Global
        </button>
        <button type="button" className={`cats__tab ${scope === 'friends' ? 'cats__tab--on' : ''}`} onClick={() => setScope('friends')}>
          👥 Amigos
        </button>
        {!isArcade && (
          <>
            <span className="cats__sep" aria-hidden="true" />
            <button type="button" className={`cats__tab ${period === 'today' ? 'cats__tab--on' : ''}`} onClick={() => setPeriod('today')}>
              Hoje
            </button>
            <button type="button" className={`cats__tab ${period === 'week' ? 'cats__tab--on' : ''}`} onClick={() => setPeriod('week')}>
              Semana
            </button>
          </>
        )}
      </div>

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

      {!isArcade && (
        <p className="game__help">
          {isWeek ? `Semana de ${weekStartKey()} · pontos só deste modo` : `Desafio de hoje · ${todayKey()}`}
        </p>
      )}

      {friendsScopeEmpty ? (
        <div className="account-card">
          <p className="account-card__hint">
            {myId ? 'Adicione amigos para comparar pontos aqui.' : 'Entre com uma conta e adicione amigos para comparar pontos aqui.'}
          </p>
          {onNavigate && (
            <button type="button" className="btn btn--ghost" onClick={() => onNavigate('friends')}>
              👥 Ir para Amigos
            </button>
          )}
        </div>
      ) : loading ? (
        <p className="game__error">Carregando ranking…</p>
      ) : error ? (
        <p className="game__error">Não consegui carregar o ranking. 📡</p>
      ) : (
        <ul className="lb">
          {count === 0 && <p className="game__error">Ninguém pontuou ainda — seja a primeira pessoa! 🚀</p>}
          {isArcade
            ? arcadeRows.map((r, i) => (
                <motion.li key={r.user_id} className={`lb__row ${r.user_id === myId ? 'lb__row--me' : ''}`} {...rowAnim(i)}>
                  <span className="lb__pos">{medal(i)}</span>
                  <span className="lb__avatar">{r.avatar_emoji}</span>
                  <span className="lb__nick">{r.nickname ?? 'Anônimo'}</span>
                  <span className="lb__value">
                    {r.best_score} {board === 'marathon' ? 'pts' : 'acertos'}
                  </span>
                </motion.li>
              ))
            : isWeek
              ? weekRows.map((r, i) => (
                  <motion.li key={r.user_id} className={`lb__row ${r.user_id === myId ? 'lb__row--me' : ''}`} {...rowAnim(i)}>
                    <span className="lb__pos">{medal(i)}</span>
                    <span className="lb__avatar">{r.avatar_emoji}</span>
                    <span className="lb__nick">{r.nickname ?? 'Anônimo'}</span>
                    <span className="lb__squares">
                      {r.days_played} {r.days_played === 1 ? 'dia' : 'dias'}
                    </span>
                    <span className="lb__value">{r.points} pts</span>
                  </motion.li>
                ))
              : sortedDaily.map((r, i) => (
                  <motion.li key={r.user_id} className={`lb__row ${r.user_id === myId ? 'lb__row--me' : ''}`} {...rowAnim(i)}>
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
