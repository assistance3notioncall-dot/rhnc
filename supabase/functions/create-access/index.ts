// Edge Function "create-access".
//
// Ouvre l'accès à des salariés qui ont déjà une fiche. Pour chacun : crée la
// ligne `auth.users` avec un mot de passe provisoire, puis passe la fiche en
// `account_status = 'actif'`.
//
// Deux choix structurants :
//
// 1. Le compte Auth est créé avec `id` = l'id de la fiche. Les deux lignes
//    partagent donc le même UUID et aucun ré-encodage de clé n'est nécessaire
//    (`rekey_profile` ne sert que pour rattacher un compte créé à la main).
// 2. L'adresse e-mail vient de `internal_email()` côté base, jamais d'une
//    constante écrite ici : si les deux divergeaient, la connexion casserait
//    sans message clair.
//
// Déploiement : verify_jwt = false, `withSupabase({ auth: "user" })` valide le
// jeton et l'autorisation est ensuite vérifiée avec les droits réels du
// demandeur (`has_access('salaries', true)`), pas avec un rôle codé en dur.
import { withSupabase } from "npm:@supabase/server@^1";

const MAX_LOT = 100;
const MDP_LONGUEUR = 12;
// Sans I, l, 1, O, 0 : ces mots de passe sont recopiés à la main sur un papier.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function motDePasseProvisoire(): string {
  const octets = new Uint8Array(MDP_LONGUEUR);
  crypto.getRandomValues(octets);
  let out = "";
  for (const o of octets) out += ALPHABET[o % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

type Fiche = {
  id: string; first_name: string; last_name: string;
  username: string | null; email: string | null;
  status: string; account_status: string;
};

const nomComplet = (f: Fiche) => [f.first_name, f.last_name].filter(Boolean).join(" ").trim() || f.id;

export default {
  fetch: withSupabase({ auth: "user" }, async (req: Request, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
    }

    let profile_ids: unknown, password: unknown;
    try {
      ({ profile_ids, password } = await req.json());
    } catch {
      return Response.json({ error: "Requête invalide" }, { status: 400 });
    }
    // `password` est facultatif : fourni, il est imposé à tout le lot (reprise
    // d'un fichier existant) ; absent, chacun reçoit un mot de passe tiré au
    // hasard, ce qui reste le cas normal.
    if (password !== undefined && (typeof password !== "string" || password.length < 8)) {
      return Response.json({ error: "8 caractères minimum" }, { status: 400 });
    }
    if (!Array.isArray(profile_ids) || profile_ids.length === 0) {
      return Response.json({ error: "Aucun salarié sélectionné" }, { status: 400 });
    }
    if (profile_ids.length > MAX_LOT) {
      return Response.json({ error: `${MAX_LOT} salariés maximum par envoi` }, { status: 400 });
    }

    // Autorisation : on interroge les droits du demandeur avec SON jeton, donc
    // les règles RLS et role_permissions s'appliquent telles quelles.
    const { data: autorise, error: errDroits } = await ctx.supabase
      .rpc("has_access", { p_module: "salaries", p_edit: true });
    if (errDroits) return Response.json({ error: errDroits.message }, { status: 400 });
    if (!autorise) {
      return Response.json({ error: "Vous n'avez pas le droit de créer des accès" }, { status: 403 });
    }

    const admin = ctx.supabaseAdmin;
    const { data: fiches, error: errFiches } = await admin
      .from("profiles")
      .select("id,first_name,last_name,username,email,status,account_status")
      .in("id", profile_ids as string[]);
    if (errFiches) return Response.json({ error: errFiches.message }, { status: 400 });

    const parId = new Map<string, Fiche>(((fiches ?? []) as Fiche[]).map((f) => [f.id, f]));
    const results: { name: string; username?: string; temp_password?: string; error?: string }[] = [];

    for (const id of profile_ids as string[]) {
      const f = parId.get(id);
      if (!f) { results.push({ name: String(id), error: "Fiche introuvable" }); continue; }
      const nom = nomComplet(f);

      if (!f.username) { results.push({ name: nom, error: "Cette fiche n'a pas d'identifiant" }); continue; }
      if (f.status !== "actif") { results.push({ name: nom, error: "Salarié inactif" }); continue; }
      if (f.account_status !== "sans_compte") {
        results.push({ name: nom, error: f.account_status === "bloque" ? "Accès bloqué" : "L'accès existe déjà" });
        continue;
      }

      // Vraie adresse si la fiche en a une, sinon l'adresse technique calculée
      // par la base — même source que celle utilisée à la connexion.
      let email = f.email;
      if (!email) {
        const { data, error } = await admin.rpc("internal_email", { p_username: f.username });
        if (error || !data) { results.push({ name: nom, error: error?.message ?? "Adresse interne introuvable" }); continue; }
        email = data as string;
      }

      const temp_password = (password as string | undefined) ?? motDePasseProvisoire();
      const { error: errCreate } = await admin.auth.admin.createUser({
        id: f.id,                 // la fiche et le compte partagent le même UUID
        email,
        password: temp_password,
        email_confirm: true,      // aucune boîte à confirmer pour une adresse technique
      });
      if (errCreate) { results.push({ name: nom, error: errCreate.message }); continue; }

      const { error: errMaj } = await admin
        .from("profiles")
        .update({ account_status: "actif", account_created_at: new Date().toISOString() })
        .eq("id", f.id);
      if (errMaj) {
        // Le compte existe mais la fiche n'a pas suivi : on le dit plutôt que
        // d'annoncer un succès qui laisserait un état incohérent.
        results.push({ name: nom, error: `Compte créé mais fiche non mise à jour : ${errMaj.message}` });
        continue;
      }

      results.push({ name: nom, username: f.username, temp_password });
    }

    return Response.json({ results });
  }),
};
