import { todayKey } from './daily'

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // sem espaço — o jogo continua funcionando, só não persiste
  }
}

// ─── Progresso do dia (por modo/categoria) ───

export function loadDayState<T>(mode: string): T | null {
  return read<T>(`songsfy:day:${todayKey()}:${mode}`)
}

export function saveDayState(mode: string, state: unknown): void {
  write(`songsfy:day:${todayKey()}:${mode}`, state)
}

// ─── Trava do dia vinda da conta ───
// O progresso acima é do aparelho. Quem já jogou fica registrado em `results`, no
// servidor — sem ler isso de volta, trocar de navegador, reinstalar o PWA ou entrar
// pela primeira vez num aparelho liberava o desafio de novo. A trava guarda só o
// resumo do resultado; os palpites em si não são reconstituíveis.

export interface DayLock {
  won: boolean
  attempts: number | null
  score: number | null
  squares: string | null
}

export function loadDayLock(mode: string): DayLock | null {
  return read<DayLock>(`songsfy:done:${todayKey()}:${mode}`)
}

export function saveDayLock(mode: string, lock: DayLock): void {
  write(`songsfy:done:${todayKey()}:${mode}`, lock)
}

// ─── Recordes dos modos arcade ───

export function loadBest(mode: string): number {
  return read<number>(`songsfy:best:${mode}`) ?? 0
}

export function saveBest(mode: string, score: number): number {
  const best = Math.max(loadBest(mode), score)
  write(`songsfy:best:${mode}`, best)
  return best
}

// ─── Estatísticas acumuladas ───

export interface Stats {
  played: number
  wins: number
  streak: number
  maxStreak: number
  lastWinDay: string
  distribution: number[] // vitórias por nº da tentativa (1..6)
}

const EMPTY_STATS: Stats = { played: 0, wins: 0, streak: 0, maxStreak: 0, lastWinDay: '', distribution: [0, 0, 0, 0, 0, 0] }

export function loadStats(mode: string): Stats {
  return read<Stats>(`songsfy:stats:${mode}`) ?? { ...EMPTY_STATS, distribution: [0, 0, 0, 0, 0, 0] }
}

export function recordResult(mode: string, won: boolean, attempt: number): Stats {
  const s = loadStats(mode)
  const today = todayKey()
  const yesterday = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })()

  s.played += 1
  if (won) {
    s.wins += 1
    s.streak = s.lastWinDay === yesterday || s.lastWinDay === today ? s.streak + 1 : 1
    s.maxStreak = Math.max(s.maxStreak, s.streak)
    s.lastWinDay = today
    if (attempt >= 1 && attempt <= 6) s.distribution[attempt - 1] += 1
  } else {
    s.streak = 0
  }
  write(`songsfy:stats:${mode}`, s)
  return s
}
