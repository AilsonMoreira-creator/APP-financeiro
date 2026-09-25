import { createClient } from '@supabase/supabase-js'
import { tokenSupabaseValido } from './sessaoToken'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// 25/09 FASE 3: manda o token do usuario (se tiver e estiver valido); senao, a chave anonima.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  accessToken: async () => tokenSupabaseValido(),
})
export const USER_ID = 'amicia-admin'

export async function syncData(payload) {
  const { error } = await supabase
    .from('amicia_data')
    .upsert({ user_id: USER_ID, payload, atualizado_em: new Date() }, 
             { onConflict: 'user_id' })
  return error
}

export async function loadData() {
  const { data, error } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', USER_ID)
    .single()
  return { data: data?.payload, error }
}
