// Edge Function "delete-employee".
//
// Supprime DÉFINITIVEMENT une fiche salarié et, s'il existe, son compte de
// connexion. Prévu pour les fiches créées par erreur (doublon, test, salarié
// qui n'a jamais commencé).
//
// Un salarié qui a quitté l'entreprise ne se supprime pas : on passe son
// statut à « Sorti ». Ses bulletins, congés et RDV doivent rester consultables.
// La fonction refuse donc toute fiche qui a déjà un historique et renvoie le
// détail (`history`) pour que l'écran propose « Sorti » à la place.
//
// Réservée au super admin, comme `reset-access` : vérifiée avec
// `is_super_admin()`, la règle de la base.
//
// Prérequis : la fonction SQL `delete_employee` (supabase/sql/delete_employee.sql).
// Déploiement : verify_jwt = false, comme les autres fonctions ;
// `withSupabase({ auth: "user" })` valide le jeton.
import { withSupabase } from "npm:@supabase/server@^1";

// Tables qui portent l'historique d'un salarié, avec leur libellé à l'écran.
// Une seule ligne dans l'une d'elles suffit à refuser la suppression.
const HISTORIQUE: [table: string, libelle: string][] = [
  ["payslips", "bulletin(s) de paie"],
  ["payroll_inputs", "élément(s) de paie"],
  ["salary_changes", "changement(s) de salaire"],
  ["requests", "demande(s)"],
  ["attendance_events", "absence(s) / retard(s)"],
  ["documents", "document(s)"],
  ["stats_agent_month", "mois de stats RDV"],
];

export default {
  fetch: withSupabase({ auth: "user" }, async (req: Request, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
    }

    let profile_id: unknown;
    try {
      ({ profile_id } = await req.json());
    } catch {
      return Response.json({ error: "Requête invalide" }, { status: 400 });
    }
    if (typeof profile_id !== "string" || !profile_id) {
      return Response.json({ error: "Salarié non précisé" }, { status: 400 });
    }

    const { data: estSuper, error: errDroits } = await ctx.supabase.rpc("is_super_admin");
    if (errDroits) return Response.json({ error: errDroits.message }, { status: 400 });
    if (!estSuper) {
      return Response.json({ error: "Réservé au super admin" }, { status: 403 });
    }

    // Identité lue auprès du client porteur du jeton (voir reset-access).
    const { data: moi } = await ctx.supabase.auth.getUser();
    if (!moi?.user?.id) {
      return Response.json({ error: "Session invalide" }, { status: 401 });
    }
    if (profile_id === moi.user.id) {
      return Response.json({ error: "Vous ne pouvez pas supprimer votre propre fiche" }, { status: 400 });
    }

    const admin = ctx.supabaseAdmin;
    const { data: fiche, error: errFiche } = await admin
      .from("profiles")
      .select("id,first_name,last_name,username,role_key,account_status")
      .eq("id", profile_id)
      .maybeSingle();
    if (errFiche) return Response.json({ error: errFiche.message }, { status: 400 });
    if (!fiche) return Response.json({ error: "Fiche introuvable" }, { status: 404 });
    if (fiche.role_key === "super_admin") {
      return Response.json({ error: "Un super admin ne peut pas être supprimé" }, { status: 400 });
    }
    const nom = [fiche.first_name, fiche.last_name].filter(Boolean).join(" ").trim() || fiche.id;

    // Historique. Une table absente ou sans colonne `profile_id` est ignorée :
    // la contrainte de clé étrangère, plus bas, reste le dernier garde-fou.
    const history: Record<string, number> = {};
    for (const [table, libelle] of HISTORIQUE) {
      const { count, error } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("profile_id", fiche.id);
      if (!error && count) history[libelle] = count;
    }
    if (Object.keys(history).length) {
      const detail = Object.entries(history).map(([l, n]) => `${n} ${l}`).join(", ");
      return Response.json({
        error: `${nom} a un historique (${detail}). Passez plutôt son statut à « Sorti ».`,
        history,
      }, { status: 409 });
    }

    // Fiche d'abord, en une transaction : si elle échoue, rien n'est perdu et
    // le compte de connexion est intact.
    const { error: errSuppr } = await admin.rpc("delete_employee", { p_profile: fiche.id });
    if (errSuppr) {
      if (errSuppr.code === "23503") {
        const table = /from table "([^"]+)"/.exec(errSuppr.details ?? "")?.[1];
        return Response.json({
          error: `${nom} est encore lié à d'autres données${table ? ` (${table})` : ""}. Passez plutôt son statut à « Sorti ».`,
          history: {},
        }, { status: 409 });
      }
      return Response.json({ error: errSuppr.message }, { status: 400 });
    }

    // Puis le compte Auth (même UUID que la fiche, voir create-access).
    if (fiche.account_status !== "sans_compte") {
      const { error } = await admin.auth.admin.deleteUser(fiche.id);
      if (error && !/not found/i.test(error.message)) {
        return Response.json({
          error: `Fiche supprimée, mais le compte de connexion n'a pas pu l'être : ${error.message}`,
        }, { status: 500 });
      }
    }

    return Response.json({ name: nom, username: fiche.username });
  }),
};
