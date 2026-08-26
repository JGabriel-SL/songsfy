interface EqualizerProps {
  active: boolean
  bars?: number
}

export function Equalizer({ active, bars = 5 }: EqualizerProps) {
  return (
    <span className={`eq ${active ? 'eq--active' : ''}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="eq__bar" style={{ animationDelay: `${i * 0.13}s` }} />
      ))}
    </span>
  )
}
