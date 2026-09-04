import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, onlineEnabled } from './supabase'
import { flushQueue, hydrateTodayLocks, importLocalStatsOnce } from './sync'
import { syncPushSubscription, unsubscribePushOnSignOut } from './push'

export interface Profile {
  id: string
  nickname: string | null
  avatar_emoji: string
  friend_code: string | null
}

interface AuthContextValue {
  online: boolean
  user: User | null
  profile: Profile | null
  loading: boolean
  isAnonymous: boolean
  signInGoogle: () => Promise<string | null>
  signInEmail: (email: string, password: string) => Promise<string | null>
  signUpEmail: (email: string, password: string) => Promise<string | null>
  signInAnonymous: (nickname: string) => Promise<string | null>
  linkEmail: (email: string, password: string) => Promise<string | null>
  updateProfile: (nickname: string, avatarEmoji: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Traduz os erros mais comuns do Supabase Auth
function friendly(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (m.includes('already registered')) return 'Este e-mail já tem cadastro — use "Entrar".'
  if (m.includes('password should be')) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (m.includes('rate limit')) return 'Muitas tentativas — aguarde um instante.'
  if (m.includes('anonymous sign-ins are disabled')) return 'Login anônimo não está habilitado no projeto.'
  if (m.includes('duplicate key') && m.includes('nickname')) return 'Este apelido já está em uso.'
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(onlineEnabled)

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return
    const { data } = await supabase.from('profiles').select('id,nickname,avatar_emoji,friend_code').eq('id', userId).maybeSingle()
    if (data) setProfile(data as Profile)
  }, [])

  useEffect(() => {
    if (!supabase) return
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)
      if (u) {
        void loadProfile(u.id)
        void flushQueue()
        void hydrateTodayLocks()
        void importLocalStatsOnce()
        void syncPushSubscription()
      } else {
        setProfile(null)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const updateProfile = useCallback(
    async (nickname: string, avatarEmoji: string): Promise<string | null> => {
      if (!supabase || !user) return 'Sem sessão.'
      const { error } = await supabase
        .from('profiles')
        .update({ nickname: nickname.trim(), avatar_emoji: avatarEmoji })
        .eq('id', user.id)
      if (error) return friendly(error.message)
      await loadProfile(user.id)
      return null
    },
    [user, loadProfile],
  )

  const value: AuthContextValue = {
    online: onlineEnabled,
    user,
    profile,
    loading,
    isAnonymous: !!user?.is_anonymous,

    signInGoogle: async () => {
      if (!supabase) return 'Modo online não configurado.'
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
      return error ? friendly(error.message) : null
    },

    signInEmail: async (email, password) => {
      if (!supabase) return 'Modo online não configurado.'
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return error ? friendly(error.message) : null
    },

    signUpEmail: async (email, password) => {
      if (!supabase) return 'Modo online não configurado.'
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      })
      return error ? friendly(error.message) : null
    },

    signInAnonymous: async (nickname) => {
      if (!supabase) return 'Modo online não configurado.'
      const clean = nickname.trim()
      if (clean.length < 2) return 'Escolha um apelido com pelo menos 2 letras.'
      const { data, error } = await supabase.auth.signInAnonymously()
      if (error) return friendly(error.message)
      if (data.user) {
        const { error: profErr } = await supabase.from('profiles').update({ nickname: clean }).eq('id', data.user.id)
        if (profErr) return friendly(profErr.message)
      }
      return null
    },

    linkEmail: async (email, password) => {
      if (!supabase) return 'Modo online não configurado.'
      const { error } = await supabase.auth.updateUser({ email, password }, { emailRedirectTo: window.location.origin })
      return error ? friendly(error.message) : null
    },

    updateProfile,

    signOut: async () => {
      // o dispositivo não deve continuar recebendo avisos desta conta
      await unsubscribePushOnSignOut().catch(() => {})
      await supabase?.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
