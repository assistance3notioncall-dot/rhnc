import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// `PUBLISHABLE_KEY` est le nom actuel ; `ANON_KEY` reste accepté pour les anciens déploiements.
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Pas de valeur de repli : une config absente doit échouer tout de suite,
  // et non produire un client qui renvoie 401 sur chaque requête.
  throw new Error(
    "Config Supabase manquante : renseigner NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (voir .env.local.example).",
  );
}

// Un seul client navigateur. Toute la sécurité est côté base (RLS + fonctions).
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "rh360-auth" },
});

export const COMPANY_ID = "c0000000-0000-4000-8000-000000000001";

/** Lance une erreur lisible si Supabase renvoie une erreur. */
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
