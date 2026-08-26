import { motion } from 'framer-motion'
import { dayNumber } from '../lib/daily'
import { loadBest } from '../lib/storage'
import { useAuth } from '../lib/auth'
import { Equalizer } from './Equalizer'
import type { Screen } from '../App'

interface HomeProps {
  onNavigate: (screen: Screen) => void
}

const cardVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.95 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { delay: 0.1 + i * 0.09, type: 'spring' as const, stiffness: 260, damping: 22 },
  }),
}

export function Home({ onNavigate }: HomeProps) {
  const auth = useAuth()
  const bestMarathon = loadBest('marathon')
  const bestBlitz = loadBest('blitz')

  return (
    <div className="home">
      <motion.div className="home__topactions" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <button type="button" className="chip" onClick={() => onNavigate('rankings')}>
          🏆 Ranking
        </button>
        <button type="button" className="chip" onClick={() => onNavigate('account')}>
          {auth.user ? `${auth.profile?.avatar_emoji ?? '👤'} ${auth.profile?.nickname ?? 'Perfil'}` : '👤 Entrar'}
        </button>
      </motion.div>
      <motion.div
        className="home__hero"
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      >
        <div className="home__logo">
          <Equalizer active bars={5} />
          <h1 className="home__title">Songsfy</h1>
          <Equalizer active bars={5} />
        </div>
        <p className="home__tagline">
          Um jogo musical por dia. Ouça, arrisque, acerte. <span className="home__day">Desafio #{dayNumber()}</span>
        </p>
      </motion.div>

      <div className="home__cards">
        <motion.h2 className="home__section" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
          🌅 Desafios do dia
        </motion.h2>

        <motion.button
          type="button"
          className="mode-card mode-card--single"
          custom={0}
          variants={cardVariants}
          initial="hidden"
          animate="show"
          whileHover={{ y: -6, scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => onNavigate('single')}
        >
          <span className="mode-card__emoji">🎧</span>
          <span className="mode-card__name">Música do Dia</span>
          <span className="mode-card__desc">
            Adivinhe a faixa secreta em até 6 tentativas. A cada erro, um trecho maior e uma nova dica.
          </span>
          <span className="mode-card__cta">Jogar →</span>
        </motion.button>

        <motion.button
          type="button"
          className="mode-card mode-card--set"
          custom={1}
          variants={cardVariants}
          initial="hidden"
          animate="show"
          whileHover={{ y: -6, scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => onNavigate('set')}
        >
          <span className="mode-card__emoji">🔥</span>
          <span className="mode-card__name">Músicas do Dia</span>
          <span className="mode-card__desc">
            6 prévias para reconhecer entre 9 opções, na ordem que quiser. Escolha sua arena.
          </span>
          <span className="mode-card__cta">Jogar →</span>
        </motion.button>

        <motion.button
          type="button"
          className="mode-card mode-card--cover"
          custom={2}
          variants={cardVariants}
          initial="hidden"
          animate="show"
          whileHover={{ y: -6, scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => onNavigate('cover')}
        >
          <span className="mode-card__emoji">🖼️</span>
          <span className="mode-card__name">Capa do Dia</span>
          <span className="mode-card__desc">
            A capa do álbum começa borrada e clareia a cada erro. Reconheça em 6 tentativas.
          </span>
          <span className="mode-card__cta">Jogar →</span>
        </motion.button>

        <motion.h2 className="home__section" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
          🕹️ Arcade — jogue sem limite
        </motion.h2>

        <div className="home__arcade">
          <motion.button
            type="button"
            className="mode-card mode-card--marathon mode-card--compact"
            custom={3}
            variants={cardVariants}
            initial="hidden"
            animate="show"
            whileHover={{ y: -6, scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onNavigate('marathon')}
          >
            <span className="mode-card__emoji">🏃</span>
            <span className="mode-card__name">Maratona</span>
            <span className="mode-card__desc">3 vidas, combos e pontuação.</span>
            <span className="mode-card__cta">{bestMarathon > 0 ? `🏆 ${bestMarathon} pts` : 'Jogar →'}</span>
          </motion.button>

          <motion.button
            type="button"
            className="mode-card mode-card--blitz mode-card--compact"
            custom={4}
            variants={cardVariants}
            initial="hidden"
            animate="show"
            whileHover={{ y: -6, scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onNavigate('blitz')}
          >
            <span className="mode-card__emoji">⚡</span>
            <span className="mode-card__name">Relâmpago</span>
            <span className="mode-card__desc">60s no relógio, +2s por acerto.</span>
            <span className="mode-card__cta">{bestBlitz > 0 ? `🏆 ${bestBlitz} acertos` : 'Jogar →'}</span>
          </motion.button>
        </div>
      </div>

      <motion.p className="home__footer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
        Novas músicas todo dia à meia-noite 🌙 · Prévias via iTunes · v8
      </motion.p>
    </div>
  )
}
