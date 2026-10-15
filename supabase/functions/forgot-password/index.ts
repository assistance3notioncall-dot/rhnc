// Edge Function "forgot-password".
//
// Appelée depuis l'écran de connexion par un salarié qui a oublié son mot de
// passe : elle enregistre une demande dans `password_reset_requests` et prévient
// chaque super admin par une notification. C'est ensuite le super admin qui pose
// un nouveau mot de passe avec `reset-access`.
//
// La réponse est TOUJOURS la même, que l'identifiant existe ou non : sinon la
// fonction devient un moyen de tester quels identifiants existent (même règle
// que `login`).
//
// Déploiement : verify_jwt = false, comme `login` — l'appelant n'est pas
// connecté et la clé publique `sb_publishable_…` n'est pas un JWT.
import { withSupabase } from "npm:@supabase/server@^1";

const OK = { ok: true };

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req: Request, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
    }

    let username: unknown;
    try {
      ({ username } = await req.json());
    } catch {
      return Response.json({ error: "Requête invalide" }, { status: 400 });
    }
    if (typeof username !== "string" || !username.trim()) {
      return Response.json({ error: "Identifiant requis" }, { status: 400 });
    }
    const saisie = username.trim().toLowerCase();

    const admin = ctx.supabaseAdmin;
    // Mêmes conditions que `email_for_username` : un compte bloqué ou sans
    // accès n'a rien à réinitialiser. Identifiant d'abord, e-mail ensuite —
    // deux requêtes plutôt qu'un `.or()` construit avec la saisie.
    const colonnes = "id,first_name,last_name,username";
    let { data: fiche } = await admin.from("profiles").select(colonnes)
      .eq("status", "actif").eq("account_status", "actif").eq("username", saisie).maybeSingle();
    if (!fiche) {
      const echappe = saisie.replace(/[\\%_]/g, (c) => "\\" + c);
      ({ data: fiche } = await admin.from("profiles").select(colonnes)
        .eq("status", "actif").eq("account_status", "actif").ilike("email", echappe).limit(1).maybeSingle());
    }
    if (!fiche) return Response.json(OK);

    // L'index unique partiel refuse une 2e demande en attente (23505) : on ne
    // renotifie pas, l'admin a déjà la première.
    const { error: errDemande } = await admin.from("password_reset_requests").insert({ profile_id: fiche.id });
    if (errDemande) {
      if (errDemande.code !== "23505") console.error("forgot-password", errDemande.message);
      return Response.json(OK);
    }

    const nom = [fiche.first_name, fiche.last_name].filter(Boolean).join(" ").trim() || fiche.username;
    const { data: supers } = await admin.from("profiles").select("id")
      .eq("role_key", "super_admin").eq("status", "actif");
    if (supers?.length) {
      await admin.from("notifications").insert(supers.map((s) => ({
        profile_id: s.id,
        title: "Mot de passe oublié",
        body: `${nom} (identifiant : ${fiche.username}) demande un nouveau mot de passe.`,
        link: "/admin",
      })));
    }

    return Response.json(OK);
  }),
};
