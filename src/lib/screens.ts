// As telas do app e seus títulos. Módulo próprio porque App, a casca (AppShell) e o
// sino de notificações precisam disso — deixar em App.tsx faria os três se importarem
// em círculo.

export type Screen =
  | 'home'
  | 'single'
  | 'set'
  | 'cover'
  | 'marathon'
  | 'blitz'
  | 'battle'
  | 'account'
  | 'rankings'
  | 'friends'

export const TITLES: Record<Screen, string> = {
  home: 'Songsfy',
  single: '🎧 Música do Dia',
  set: '🔥 Músicas do Dia',
  cover: '🖼️ Capa do Dia',
  marathon: '🏃 Maratona',
  blitz: '⚡ Relâmpago',
  battle: '⚔️ Batalha',
  account: '👤 Conta',
  rankings: '🏆 Ranking',
  friends: '👥 Amigos',
}

export function isScreen(value: string | null | undefined): value is Screen {
  return !!value && value in TITLES
}
