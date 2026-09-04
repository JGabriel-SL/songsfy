// "Você já jogou isso hoje" — mostrado quando a conta tem o resultado do dia mas
// este aparelho não tem o progresso (outro navegador, PWA reinstalado, primeiro
// acesso por aqui). O servidor guarda o resumo, não os palpites, então esta tela
// mostra o placar em vez de reconstituir o jogo.

import { motion } from 'framer-motion'
import type { DayLock } from '../lib/storage'

export function DailyLocked({ label, lock }: { label: string; lock: DayLock }) {
  return (
    <motion.div className="account-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <span className="account-card__avatar">{lock.won ? '✅' : '🙈'}</span>
      <h2>{lock.won ? 'Você já mandou bem hoje' : 'Você já tentou hoje'}</h2>
      <p className="account-card__hint">
        O resultado de hoje em <strong>{label}</strong> está salvo na sua conta. O próximo desafio sai à meia-noite 🌙
      </p>

      {lock.squares && <p className="locked__squares">{lock.squares}</p>}

      <p className="locked__meta">
        {lock.attempts !== null && `${lock.attempts} ${lock.attempts === 1 ? 'tentativa' : 'tentativas'}`}
        {lock.attempts !== null && lock.score !== null && ' · '}
        {lock.score !== null && `${lock.score} ${lock.score === 1 ? 'ponto' : 'pontos'}`}
      </p>
    </motion.div>
  )
}
