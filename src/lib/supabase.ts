import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// O modo online é opcional: sem as variáveis de ambiente o app roda 100% local.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null

export const onlineEnabled = supabase !== null
