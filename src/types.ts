export type CategoryId = 'pop' | 'rock' | 'brasil' | 'sertanejo' | 'eletronica' | 'hiphop'

export interface Song {
  id: string
  title: string
  artist: string
  year: number
  genre: string
  category: CategoryId
  /** Termo alternativo de busca no iTunes, quando "título + artista" retorna covers primeiro */
  searchTerm?: string
}

export interface TrackInfo {
  previewUrl: string
  artworkUrl: string
  album: string
}

export interface Category {
  id: CategoryId
  label: string
  emoji: string
}
