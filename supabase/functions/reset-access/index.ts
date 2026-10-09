// Edge Function "reset-access".
//
// Pose le mot de passe choisi par le super admin sur le compte d'un salarié
// qui a oublié le sien. Rien n'est généré : c'est l'admin qui saisit, et la
// réponse ne renvoie pas le mot de passe.
//
// Réservée au super admin — pas au rôle RH, contrairement à `create-access` :
// ouvrir un accès à quelqu'un qui n'en avait pas et reprendre la main sur un
// compte existant ne portent pas le même risque. L'autorisation est vérifiée
// avec `is_super_admin()`, c'est-à-dire la règle de la base, pas une liste
// écrite ici.
//
// Limite connue : les sessions déjà ouvertes du salarié restent valides
// jusqu'à l'expiration de leur jeton (environ une heure). Changer le mot de
// passe empêche toute NOUVELLE connexion, pas celles en cours. Pour couper
// l'accès immédiatement, utilisez l'interrupteur « Statut » qui bloque le
// compte.
import { withSupabase } from "npm:@supabase/server@^1";

// Le super admin saisit lui-même le mot de passe : rien n'est généré ici.
// Même minimum que l'écran /mot-de-passe de l'application, pour qu'un mot de
// passe posé par l'admin ne soit pas plus faible que ce qu'un salarié peut
// choisir lui-même.
const MDP_MIN = 8;

export default {
  fetch: withSupabase({ auth: "user" }, async (req: Request, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
    }

    let profile_id: unknown, password: unknown;
    try {
      ({ profile_id, password } = await req.json());
    } catch {
      return Response.json({ error: "Requête invalide" }, { status: 400 });
    }
    if (typeof profile_id !== "string" || !profile_id) {
      return Response.json({ error: "Salarié non précisé" }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < MDP_MIN) {
      return Response.json({ error: `${MDP_MIN} caractères minimum` }, { status: 400 });
    }

    const { data: estSuper, error: errDroits } = await ctx.supabase.rpc("is_super_admin");
    if (errDroits) return Response.json({ error: errDroits.message }, { status: 400 });
    if (!estSuper) {
      return Response.json({ error: "Réservé au super admin" }, { status: 403 });
    }

    // `ctx.userClaims` ne porte pas forcément `sub` : on demande l'identité au
    // client porteur du jeton, qui fait autorité. S'en remettre aux claims a
    // laissé passer une réinitialisation de son propre mot de passe en test.
    const { data: moi } = await ctx.supabase.auth.getUser();
    if (!moi?.user?.id) {
      return Response.json({ error: "Session invalide" }, { status: 401 });
    }
    if (profile_id === moi.user.id) {
      return Response.json(
        { error: "Changez votre propre mot de passe depuis Profil" },
        { status: 400 },
      );
    }

    const admin = ctx.supabaseAdmin;
    const { data: fiche, error: errFiche } = await admin
      .from("profiles")
      .select("id,first_name,last_name,username,account_status")
      .eq("id", profile_id)
      .maybeSingle();
    if (errFiche) return Response.json({ error: errFiche.message }, { status: 400 });
    if (!fiche) return Response.json({ error: "Fiche introuvable" }, { status: 404 });
    if (fiche.account_status === "sans_compte") {
      return Response.json({ error: "Ce salarié n'a pas encore d'accès" }, { status: 400 });
    }

    const { error } = await admin.auth.admin.updateUserById(fiche.id, { password });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    // Le mot de passe n'est pas renvoyé : l'admin vient de le saisir, et le
    // réémettre dans une réponse HTTP ne ferait que l'exposer davantage.
    return Response.json({
      name: [fiche.first_name, fiche.last_name].filter(Boolean).join(" ").trim() || fiche.id,
      username: fiche.username,
    });
  }),
};
