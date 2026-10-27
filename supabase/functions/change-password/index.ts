// Edge Function "change-password".
//
// Seul chemin autorisé pour lever le drapeau `must_change_password`.
// Le drapeau vit dans `app_metadata`, que seule la clé secrète peut écrire :
// la levée est donc liée au vrai changement de mot de passe, et non à un appel
// que le navigateur pourrait fabriquer. Avec le drapeau dans `user_metadata`,
// n'importe quel salarié pouvait le remettre à false depuis la console sans
// jamais remplacer son mot de passe provisoire.
//
// Déploiement : verify_jwt = false, comme create-access / reset-access — le projet
// utilise les nouvelles clés de signature JWT, que la vérification de la passerelle
// ne gère pas. `withSupabase({ auth: "user" })` valide le jeton, puis `getUser()`
// confirme l'identité côté Auth : un appel sans session valide est refusé (401).
import { withSupabase } from "npm:@supabase/server@^1";

const MIN_LEN = 8;

export default {
  fetch: withSupabase({ auth: "user" }, async (req: Request, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
    }

    let password: unknown;
    try {
      ({ password } = await req.json());
    } catch {
      return Response.json({ error: "Requête invalide" }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < MIN_LEN) {
      return Response.json({ error: `${MIN_LEN} caractères minimum` }, { status: 400 });
    }

    // Ne pas lire `ctx.userClaims.sub` : ce champ n'est pas garanti, et s'y
    // fier a déjà laissé passer un contrôle d'identité dans `reset-access`.
    // Le client porteur du jeton fait autorité.
    const { data: moi } = await ctx.supabase.auth.getUser();
    const uid = moi?.user?.id;
    if (!uid) return Response.json({ error: "Session invalide" }, { status: 401 });

    const admin = ctx.supabaseAdmin;

    // On réécrit app_metadata à partir de l'existant : correct que GoTrue fusionne
    // les clés fournies ou qu'il remplace l'objet, et `provider` / `providers`
    // sont préservés dans les deux cas.
    const { data: current, error: readErr } = await admin.auth.admin.getUserById(uid);
    if (readErr || !current?.user) {
      return Response.json({ error: readErr?.message ?? "Compte introuvable" }, { status: 400 });
    }

    const { error } = await admin.auth.admin.updateUserById(uid, {
      password,
      app_metadata: { ...(current.user.app_metadata ?? {}), must_change_password: false },
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    return Response.json({ ok: true });
  }),
};
