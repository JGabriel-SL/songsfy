// Sincronização best-effort com o Supabase: resultados diários, recordes arcade
// e importação única das estatísticas locais. Nunca bloqueia o jogo — falhas
// entram numa fila no localStorage e são reenviadas na próxima oportunidade.

import { supabase } from './supabase'
import { todayKey } from './daily'
import { loadStats } from './storage'

const QUEUE_KEY = 'songsfy:sync:queue:v1'
const IMPORT_FLAG_KEY = 'songsfy:sync:imported:v1'

interface QueueItem {
  kind: 'result' | 'arcade'
  payload: Record<string, unknown>
}

function readQueue(): QueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueueItem[]
  } catch {
    return []
  }
}

function writeQueue(items: QueueItem[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-50)))
  } catch {
    // sem espaço: descarta silenciosamente
  }
}

async function send(item: QueueItem): Promise<boolean> {
  if (!supabase) return false
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return false
  const fn = item.kind === 'result' ? 'submit_result' : 'submit_arcade'
  const { error } = await supabase.rpc(fn, item.payload)
  // erros de validação/duplicidade não devem ficar reenfileirados para sempre
  if (error && !/rede|network|fetch/i.test(error.message)) return true
  return !error
}

async function submit(item: QueueItem): Promise<void> {
  const ok = await send(item).catch(() => false)
  if (!ok) writeQueue([...readQueue(), item])
}

export interface DailyResult {
  won: boolean
  attempts: number | null
  score: number | null
  squares: string
}

/** Registra um resultado diário (mode: 'single' | 'cover' | 'set:pop' | ...). */
export async function submitResult(mode: string, r: DailyResult): Promise<void> {
  await submit({
    kind: 'result',
    payload: { p_date: todayKey(), p_mode: mode, p_won: r.won, p_attempts: r.attempts, p_score: r.score, p_squares: r.squares },
  })
}

/** Registra um recorde arcade (mode: 'marathon' | 'blitz'). */
export async function submitArcade(mode: 'marathon' | 'blitz', score: number): Promise<void> {
  await submit({ kind: 'arcade', payload: { p_mode: mode, p_score: score } })
}

/** Reenvia itens pendentes (chamado ao logar e ao abrir o app). */
export async function flushQueue(): Promise<void> {
  const items = readQueue()
  if (items.length === 0) return
  writeQueue([])
  for (const item of items) {
    await submit(item)
  }
}

/** Importa as estatísticas locais para a conta, uma única vez por navegador. */
export async function importLocalStatsOnce(): Promise<void> {
  if (!supabase) return
  if (localStorage.getItem(IMPORT_FLAG_KEY)) return
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return

  for (const mode of ['single', 'cover']) {
    const s = loadStats(mode)
    if (s.played === 0) continue
    await supabase.rpc('import_stats', {
      p_mode: mode,
      p_played: s.played,
      p_wins: s.wins,
      p_streak: s.streak,
      p_max_streak: s.maxStreak,
      p_last_win_day: s.lastWinDay || null,
      p_distribution: s.distribution,
    })
  }

  // recordes arcade locais também sobem
  for (const mode of ['marathon', 'blitz'] as const) {
    const raw = localStorage.getItem(`songsfy:best:${mode}`)
    const best = raw ? Number(JSON.parse(raw)) : 0
    if (best > 0) await supabase.rpc('submit_arcade', { p_mode: mode, p_score: best })
  }

  try {
    localStorage.setItem(IMPORT_FLAG_KEY, '1')
  } catch {
    // sem espaço
  }
}
