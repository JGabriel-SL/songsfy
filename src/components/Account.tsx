import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../lib/auth'

const AVATARS = ['🎧', '🎤', '🎸', '🎹', '🥁', '🎷', '🎺', '🎻', '📀', '🔥', '⚡', '🌟', '🦜', '🐆', '🌵', '🍍']

export function Account() {
  const auth = useAuth()
  const [tab, setTab] = useState<'anon' | 'email'>('anon')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // edição de perfil
  const [editNick, setEditNick] = useState<string | null>(null)
  const [editAvatar, setEditAvatar] = useState<string | null>(null)

  const run = async (fn: () => Promise<string | null>, successNotice?: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    const err = await fn()
    setBusy(false)
    if (err) setError(err)
    else if (successNotice) setNotice(successNotice)
  }

  if (!auth.online) {
    return (
      <div className="game">
        <div className="account-card">
          <h2>Modo online não configurado 🔌</h2>
          <p className="account-card__hint">
            Contas, rankings e sincronização precisam de um projeto Supabase. Siga a seção <strong>"Ativando o modo
            online"</strong> do README: crie o projeto, rode a migração e preencha o <code>.env.local</code> com a URL e
            a chave anônima. O jogo continua funcionando normalmente no modo local.
          </p>
        </div>
      </div>
    )
  }

  if (auth.loading) {
    return (
      <div className="game">
        <p className="game__error">Carregando…</p>
      </div>
    )
  }

  // ─── Logado: perfil ───
  if (auth.user) {
    const nick = editNick ?? auth.profile?.nickname ?? ''
    const avatar = editAvatar ?? auth.profile?.avatar_emoji ?? '🎧'
    return (
      <motion.div className="game" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="account-card">
          <span className="account-card__avatar">{avatar}</span>
          <h2>{auth.profile?.nickname ?? 'Sem apelido'}</h2>
          <p className="account-card__hint">
            {auth.isAnonymous ? 'Conta anônima — vincule um e-mail para não perder o progresso.' : auth.user.email}
          </p>

          <label className="account-field">
            Apelido
            <input
              type="text"
              value={nick}
              maxLength={20}
              onChange={(e) => setEditNick(e.target.value)}
              placeholder="Seu apelido no ranking"
            />
          </label>

          <div className="avatar-picker">
            {AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                className={`avatar-picker__item ${a === avatar ? 'avatar-picker__item--on' : ''}`}
                onClick={() => setEditAvatar(a)}
              >
                {a}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn btn--play"
            disabled={busy || nick.trim().length < 2}
            onClick={() => void run(() => auth.updateProfile(nick, avatar), 'Perfil salvo! ✓')}
          >
            Salvar perfil
          </button>

          {auth.isAnonymous && (
            <div className="account-link">
              <p>Vincular e-mail e senha:</p>
              <input type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input type="password" placeholder="senha (mín. 6)" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy || !email || password.length < 6}
                onClick={() => void run(() => auth.linkEmail(email, password), 'Verifique seu e-mail para confirmar! 📬')}
              >
                Vincular conta
              </button>
            </div>
          )}

          {error && <p className="account-error">{error}</p>}
          {notice && <p className="account-notice">{notice}</p>}

          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void auth.signOut()}>
            Sair da conta
          </button>
        </div>
      </motion.div>
    )
  }

  // ─── Deslogado: entrar ───
  return (
    <motion.div className="game" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="account-card">
        <h2>Entre para ranquear 🏆</h2>
        <p className="account-card__hint">Seu progresso local continua valendo — a conta adiciona ranking e sincronização.</p>

        <button type="button" className="btn btn--play" disabled={busy} onClick={() => void run(auth.signInGoogle)}>
          Entrar com Google
        </button>

        <div className="cats" role="tablist">
          <button type="button" className={`cats__tab ${tab === 'anon' ? 'cats__tab--on' : ''}`} onClick={() => setTab('anon')}>
            ⚡ Só um apelido
          </button>
          <button type="button" className={`cats__tab ${tab === 'email' ? 'cats__tab--on' : ''}`} onClick={() => setTab('email')}>
            ✉️ E-mail
          </button>
        </div>

        {tab === 'anon' ? (
          <>
            <label className="account-field">
              Apelido
              <input
                type="text"
                value={nickname}
                maxLength={20}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Como você quer aparecer no ranking"
              />
            </label>
            <button
              type="button"
              className="btn btn--play"
              disabled={busy || nickname.trim().length < 2}
              onClick={() => void run(() => auth.signInAnonymous(nickname))}
            >
              Jogar com apelido
            </button>
          </>
        ) : (
          <>
            <label className="account-field">
              E-mail
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" />
            </label>
            <label className="account-field">
              Senha
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mín. 6 caracteres" />
            </label>
            <button
              type="button"
              className="btn btn--play"
              disabled={busy || !email || password.length < 6}
              onClick={() =>
                void run(
                  () => (mode === 'signin' ? auth.signInEmail(email, password) : auth.signUpEmail(email, password)),
                  mode === 'signup' ? 'Cadastro criado! Verifique seu e-mail. 📬' : undefined,
                )
              }
            >
              {mode === 'signin' ? 'Entrar' : 'Cadastrar'}
            </button>
            <button type="button" className="account-switch" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
              {mode === 'signin' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entrar'}
            </button>
          </>
        )}

        {error && <p className="account-error">{error}</p>}
        {notice && <p className="account-notice">{notice}</p>}
      </div>
    </motion.div>
  )
}
