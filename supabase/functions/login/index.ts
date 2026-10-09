// Edge Function "login".
//
// Connexion par identifiant : le front n'envoie jamais d'e-mail, seulement
// `username` + `password`. La traduction identifiant -> e-mail se fait ici avec
// la clé secrète, parce que `email_for_username` est révoquée pour `anon` et
// `authenticated` — sinon n'importe qui pourrait récupérer l'e-mail d'un salarié
// à partir de son identifiant.
//
// Déploiement : verify_jwt = false, obligatoire. La clé publique du projet est
// une `sb_publishable_…`, pas un JWT : la vérification de la plateforme la
// rejetterait avec « Invalid JWT ». C'est `withSupabase({ auth: "publishable" })`
// qui valide la clé.
import { withSupabase } from "npm:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@^2";

const url = Deno.env.get("SUPABASE_URL")!;

// Les nouvelles clés arrivent dans un objet JSON indexé par nom ; `default` est
// celle créée par la plateforme. Les variables héritées servent de repli.
const publishable =
  JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}")["default"] ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;

// Un seul message pour « identifiant inconnu » et « mauvais mot de passe » :
// sinon la fonction devient un moyen de tester quels identifiants existent.
const ERREUR = "Identifiant ou mot de passe incorrect";

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req: Request, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
    }

    let username: unknown, password: unknown;
    try {
      ({ username, password } = await req.json());
    } catch {
      return Response.json({ error: "Requête invalide" }, { status: 400 });
    }
    if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
      return Response.json({ error: ERREUR }, { status: 400 });
    }

    const { data: email, error: rpcErr } = await ctx.supabaseAdmin.rpc("email_for_username", {
      p_username: username.trim().toLowerCase(),
    });
    if (rpcErr || !email) {
      return Response.json({ error: ERREUR }, { status: 401 });
    }

    // Connexion avec la clé publique : on veut une vraie session utilisateur,
    // soumise aux RLS, et non une session fabriquée avec la clé secrète.
    // `persistSession: false` car l'isolat Deno est réutilisé entre les requêtes :
    // sans ça, la session d'un salarié pourrait fuiter sur l'appel suivant.
    const anon = createClient(url, publishable, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return Response.json({ error: ERREUR }, { status: 401 });
    }

    // On ne renvoie que les deux jetons attendus par app/login/page.tsx.
    return Response.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  }),
};
