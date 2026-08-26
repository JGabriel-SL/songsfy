interface VinylProps {
  spinning: boolean
  artworkUrl?: string
  size?: number
  blurred?: boolean
}

// Disco de vinil animado; a arte do álbum aparece no selo central quando revelada.
export function Vinyl({ spinning, artworkUrl, size = 180, blurred = false }: VinylProps) {
  return (
    <div className={`vinyl ${spinning ? 'vinyl--spinning' : ''}`} style={{ width: size, height: size }}>
      <div className="vinyl__disc">
        <div className="vinyl__grooves" />
        <div className="vinyl__label">
          {artworkUrl ? (
            <img src={artworkUrl} alt="Capa do álbum" className={blurred ? 'vinyl__art vinyl__art--blur' : 'vinyl__art'} draggable={false} />
          ) : (
            <span className="vinyl__note">♪</span>
          )}
        </div>
        <div className="vinyl__hole" />
        <div className="vinyl__shine" />
      </div>
    </div>
  )
}
