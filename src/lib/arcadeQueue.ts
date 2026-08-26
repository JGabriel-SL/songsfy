import { gameCatalog, getTrack } from './catalog-remote'
import type { Song, TrackInfo } from '../types'

export interface ArcadeRound {
  answer: Song
  options: Song[] // 4 opções embaralhadas (resposta + 3 distratores da mesma categoria)
  track: TrackInfo
}

function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Fila de rodadas aleatórias para os modos arcade (Maratona/Relâmpago).
 * Não repete música até esgotar o catálogo; pré-carrega as próximas rodadas
 * para a transição sair sem espera (o cache de 30d do itunes.ts ajuda).
 */
export function createArcadeQueue() {
  const catalog = gameCatalog()
  let pool = shuffle(catalog)
  let idx = 0
  const pending: Promise<ArcadeRound | null>[] = []

  const nextSong = (): Song => {
    if (idx >= pool.length) {
      pool = shuffle(catalog)
      idx = 0
    }
    return pool[idx++]
  }

  const buildRound = async (): Promise<ArcadeRound | null> => {
    // Tenta algumas músicas até achar uma com prévia disponível
    for (let attempt = 0; attempt < 6; attempt++) {
      const answer = nextSong()
      try {
        const track = await getTrack(answer)
        if (!track) continue
        const sameCategory = catalog.filter((s) => s.category === answer.category && s.id !== answer.id)
        const decoys = shuffle(sameCategory).slice(0, 3)
        return { answer, options: shuffle([answer, ...decoys]), track }
      } catch {
        continue
      }
    }
    return null
  }

  const ensure = (n: number) => {
    while (pending.length < n) pending.push(buildRound())
  }

  return {
    /** Próxima rodada pronta para tocar (ou null se a rede falhou repetidamente). */
    async next(): Promise<ArcadeRound | null> {
      ensure(1)
      let round = await pending.shift()!
      ensure(2) // pré-carrega as duas próximas
      // Rodada pré-carregada durante uma queda de rede: tenta de novo na hora
      if (!round) round = await buildRound()
      return round
    },
  }
}
