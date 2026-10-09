"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Empty, Field, Modal, PageHead, Tabs, useAction, useToast } from "@/components/ui";
import { dfr, dtfr, fullName } from "@/lib/format";

type Mod = { key: string; label: string; sort: number; delegable: boolean };
type Role = { key: string; label: string; kind: string; color: string; locked: boolean };
type Perm = { role_key: string; module_key: string; can_view: boolean; can_edit: boolean };
type User = {
  id: string; first_name: string; last_name: string; username: string | null;
  matricule: string | null; role_key: string | null; status: string; account_status: string;
  department_id: string | null; hire_date: string | null;
};
type Dept = { id: string; name: string };
type Acces = { name: string; username?: string; temp_password?: string };
type Audit = { id: number; actor_id: string | null; table_name: string; row_id: string | null; action: string; at: string };

const KIND: Record<string, string> = { salarie: "Salarié", manager: "Manager (voit son équipe)", rh: "RH (voit tout)", admin: "Admin" };
const ACTION: Record<string, string> = { INSERT: "Création", UPDATE: "Modification", DELETE: "Suppression" };
const SOUS_TITRE: Record<string, string> = {
  users: "Réservé au super admin : créer les comptes, attribuer les rôles, décider ce que chaque rôle voit.",
  roles: "Choisissez ce que chaque rôle voit (👁) et peut modifier (✎). Effet immédiat à la prochaine page ouverte.",
  journal: "Dernières modifications enregistrées, les plus récentes d'abord.",
};

export default function Admin() {
  const { me, isSuper } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState("users");
  const [mods, setMods] = useState<Mod[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [acces, setAcces] = useState<Acces | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [audit, setAudit] = useState<Audit[] | null>(null);
  const [fRole, setFRole] = useState("tous");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    const [{ data: m }, { data: r }, { data: p }, { data: e }, { data: d }] = await Promise.all([
      supabase.from("app_modules").select("*").order("sort"),
      supabase.from("app_roles").select("*").order("created_at"),
      supabase.from("role_permissions").select("role_key,module_key,can_view,can_edit"),
      supabase.from("profiles")
        .select("id,first_name,last_name,username,matricule,role_key,status,account_status,department_id,hire_date")
        .order("last_name"),
      supabase.from("departments").select("id,name").order("name"),
    ]);
    setMods((m as Mod[]) ?? []); setRoles((r as Role[]) ?? []); setPerms((p as Perm[]) ?? []);
    setUsers((e as User[]) ?? []); setDepts((d as Dept[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Le journal n'est chargé qu'à l'ouverture de son onglet : c'est la requête
  // la plus lourde et la plupart des visites ne vont pas jusque-là.
  useEffect(() => {
    if (tab !== "journal" || audit !== null) return;
    supabase.from("audit_log").select("id,actor_id,table_name,row_id,action,at")
      .order("at", { ascending: false }).limit(100)
      .then(({ data }) => setAudit((data as Audit[]) ?? []));
  }, [tab, audit]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    users.forEach((u) => { if (u.status === "actif" && u.role_key) c[u.role_key] = (c[u.role_key] ?? 0) + 1; });
    return c;
  }, [users]);

  const vus = useMemo(() => {
    const t = q.trim().toLowerCase();
    return users.filter((u) =>
      (fRole === "tous" || u.role_key === fRole) &&
      (!t || [u.first_name, u.last_name, u.username, u.matricule].some((v) => (v ?? "").toLowerCase().includes(t))),
    );
  }, [users, fRole, q]);

  // La base reste l'autorité : `protect_role` exige is_super_admin() et refuse
  // qu'on change son propre rôle. L'UI ne fait que refléter ces deux règles,
  // elle ne les remplace pas — une erreur du trigger remonte telle quelle.
  const peutChangerRole = (u: User) => isSuper && u.id !== me?.id;
  async function changerRole(u: User, role_key: string) {
    if (!role_key || role_key === u.role_key) return;
    await run(async () => {
      must(await supabase.from("profiles").update({ role_key }).eq("id", u.id));
      await load();
    }, "Rôle modifié");
  }

  // L'interrupteur bascule actif <-> bloqué. Il reste inerte tant que le
  // salarié n'a pas de compte : il n'y a alors rien à bloquer, c'est le bouton
  // clé qui ouvre l'accès. Comme pour le rôle, la base tranche : une fois
  // `protect_account_status` déployé, le basculement exigera le super admin.
  const peutBasculer = (u: User) => isSuper && u.id !== me?.id && u.account_status !== "sans_compte";
  async function basculerAcces(u: User) {
    const suivant = u.account_status === "actif" ? "bloque" : "actif";
    await run(async () => {
      must(await supabase.from("profiles").update({ account_status: suivant }).eq("id", u.id));
      await load();
    }, suivant === "bloque" ? "Accès bloqué" : "Accès débloqué");
  }

  /** Remonte le message métier de la fonction plutôt que le « Edge Function
   *  returned a non-2xx status code » générique de supabase-js. */
  async function invoquer(nom: string, body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke(nom, { body });
    if (error) {
      let m = error.message;
      try { m = (await (error as { context?: Response }).context?.json())?.error ?? m; } catch { /* */ }
      throw new Error(m);
    }
    return data;
  }

  async function creerAcces(u: User) {
    await run(async () => {
      const data = await invoquer("create-access", { profile_ids: [u.id] });
      const r = (data?.results ?? [])[0] as (Acces & { error?: string }) | undefined;
      if (!r) throw new Error("Réponse inattendue du serveur");
      if (r.error) throw new Error(r.error);
      setAcces(r);
      await load();
    });
  }

  async function reinitialiser(u: User, password: string) {
    await run(async () => {
      await invoquer("reset-access", { profile_id: u.id, password });
      setResetFor(null);
    }, `Mot de passe de ${fullName(u)} modifié`);
  }

  const get = (r: string, m: string) => perms.find((p) => p.role_key === r && p.module_key === m);
  async function toggle(role: string, mod: string, field: "can_view" | "can_edit") {
    const cur = get(role, mod) ?? { role_key: role, module_key: mod, can_view: false, can_edit: false };
    const next = { ...cur, [field]: !cur[field] };
    if (field === "can_edit" && next.can_edit) next.can_view = true;
    if (field === "can_view" && !next.can_view) next.can_edit = false;
    setPerms((ps) => [...ps.filter((p) => !(p.role_key === role && p.module_key === mod)), next]);
    await run(async () => { must(await supabase.from("role_permissions").upsert({ company_id: me!.company_id, ...next })); });
  }

  const editable = roles.filter((r) => !r.locked);
  return (
    <Guard module="admin">
      <PageHead title="Utilisateurs & rôles" sub={SOUS_TITRE[tab]}>
        {/* La saisie d'une fiche vit dans l'écran Salariés : on y renvoie plutôt
            que de dupliquer le formulaire et ses règles de validation. */}
        {tab === "users" && isSuper && <button className="btn-pri" onClick={() => router.push("/salaries")}>+ Ajouter un salarié</button>}
        {tab === "roles" && isSuper && <button className="btn-pri" onClick={() => setCreating(true)}>+ Nouveau rôle</button>}
      </PageHead>

      <div className="mb-4 border-b border-line">
        <div className="-mb-px flex flex-wrap gap-5">
          {[
            { key: "users", label: `Utilisateurs (${users.length})` },
            { key: "roles", label: "Rôles & droits" },
            { key: "journal", label: "Journal" },
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`border-b-2 pb-2.5 font-medium ${tab === t.key ? "border-pri text-pri" : "border-transparent text-mut hover:text-gray2"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "users" && (
        <>
          <Tabs value={fRole} onChange={setFRole} tabs={[
            { key: "tous", label: `Tous (${users.length})` },
            ...roles.map((r) => ({ key: r.key, label: `${r.label} (${counts[r.key] ?? 0})` })),
          ]} />
          <input className="inp mb-4 max-w-sm" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher nom, identifiant, ID…" />
          <div className="card overflow-x-auto p-0">
            <table className="tbl">
              <thead><tr><th>Identifiant</th><th>Nom</th><th>Rôle</th><th>Section</th><th>Entrée</th><th>Statut</th><th /></tr></thead>
              <tbody>{vus.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.username ?? "—"}</td>
                  <td>{fullName(u)}</td>
                  <td>
                    {peutChangerRole(u) ? (
                      <select className="inp h-8 py-0 text-[13px]" value={u.role_key ?? ""} disabled={busy}
                        onChange={(e) => changerRole(u, e.target.value)}>
                        {!u.role_key && <option value="">—</option>}
                        {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                      </select>
                    ) : (
                      <>
                        {roles.find((r) => r.key === u.role_key)?.label ?? u.role_key ?? "—"}
                        {u.id === me?.id && <div className="mut text-[11.5px]">votre propre rôle</div>}
                      </>
                    )}
                  </td>
                  <td>{depts.find((d) => d.id === u.department_id)?.name ?? "—"}</td>
                  <td className="whitespace-nowrap">{dfr(u.hire_date)}</td>
                  <td>
                    <Interrupteur
                      on={u.account_status === "actif"}
                      disabled={busy || !peutBasculer(u)}
                      onClick={() => basculerAcces(u)}
                      title={u.account_status === "sans_compte" ? "Pas encore de compte" : u.account_status === "actif" ? "Bloquer l'accès" : "Débloquer l'accès"}
                    />
                  </td>
                  <td className="text-right">
                    {u.account_status === "sans_compte" ? (
                      <button className="btn btn-sm" disabled={busy || !isSuper} title="Créer l'accès"
                        onClick={() => creerAcces(u)}>🔑</button>
                    ) : (
                      // reset-access est réservée au super admin et refuse votre
                      // propre compte : le bouton reflète ces deux règles.
                      <button className="btn btn-sm" disabled={busy || !isSuper || u.id === me?.id}
                        title={u.id === me?.id ? "Changez votre mot de passe depuis Profil" : "Définir un nouveau mot de passe"}
                        onClick={() => setResetFor(u)}>🔑</button>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {!vus.length && <Empty>{users.length ? "Aucun salarié ne correspond." : "Aucun salarié enregistré."}</Empty>}
          </div>
        </>
      )}

      {tab === "roles" && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {roles.map((r) => (
              <div key={r.key} className="card p-3">
                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: r.color }} /><b>{r.label}</b>{r.locked && <span className="badge bg-vio-l text-vio">verrouillé</span>}</div>
                <div className="mut mt-1 text-[12.5px]">{KIND[r.kind]} · {counts[r.key] ?? 0} pers.</div>
                {isSuper && !r.locked && !counts[r.key] && (
                  <button className="mt-2 text-[12.5px] text-err" onClick={() => confirm(`Supprimer le rôle ${r.label} ?`) && run(async () => { must(await supabase.from("app_roles").delete().eq("key", r.key)); await load(); }, "Rôle supprimé")}>Supprimer</button>
                )}
              </div>
            ))}
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="tbl">
              <thead><tr><th>Module</th>{editable.map((r) => <th key={r.key} className="text-center" style={{ color: r.color }}>{r.label}</th>)}</tr></thead>
              <tbody>{mods.map((m) => (
                <tr key={m.key}>
                  <td className="font-medium">{m.label}{!m.delegable && <div className="mut text-[11.5px]">réservé au super admin</div>}</td>
                  {editable.map((r) => {
                    const p = get(r.key, m.key);
                    return (
                      <td key={r.key} className="text-center">
                        {m.delegable ? (
                          <div className="inline-flex gap-1">
                            <button disabled={!isSuper || busy} title="Voir" onClick={() => toggle(r.key, m.key, "can_view")}
                              className={`h-7 w-7 rounded-md border ${p?.can_view ? "border-pri bg-pri-l" : "border-line opacity-40"}`}>👁</button>
                            <button disabled={!isSuper || busy} title="Modifier" onClick={() => toggle(r.key, m.key, "can_edit")}
                              className={`h-7 w-7 rounded-md border ${p?.can_edit ? "border-ok bg-ok-l" : "border-line opacity-40"}`}>✎</button>
                          </div>
                        ) : <span className="mut">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mut mt-3 text-[12.5px]">Pour « Absences &amp; retards » : voir = consulter, modifier = déclarer. Pour « Salaire de base » : voir = proposer un changement, modifier = l&apos;appliquer directement.</p>
        </>
      )}

      {tab === "journal" && (
        <div className="card overflow-x-auto p-0">
          <table className="tbl">
            <thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Table</th><th>Ligne</th></tr></thead>
            <tbody>{(audit ?? []).map((a) => (
              <tr key={a.id}>
                <td>{dtfr(a.at)}</td>
                <td>{fullName(users.find((u) => u.id === a.actor_id)) || "—"}</td>
                <td>{ACTION[a.action] ?? a.action}</td>
                <td>{a.table_name}</td>
                <td className="mut text-[12.5px]">{a.row_id ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          {audit === null && <Empty>Chargement…</Empty>}
          {audit?.length === 0 && <Empty>Aucune entrée enregistrée.</Empty>}
        </div>
      )}

      {creating && <NewRole roles={editable} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
      {acces && <AccesCree acces={acces} onClose={() => setAcces(null)} />}
      {resetFor && (
        <NouveauMotDePasse salarie={resetFor} busy={busy}
          onClose={() => setResetFor(null)}
          onValider={(mdp) => reinitialiser(resetFor, mdp)} />
      )}
    </Guard>
  );
}

/** Le super admin choisit le mot de passe. Double saisie, parce qu'il le
 *  dictera ensuite au salarié : une faute de frappe non détectée ici le
 *  laisserait dehors sans qu'on comprenne pourquoi. */
function NouveauMotDePasse(
  { salarie, busy, onClose, onValider }:
  { salarie: User; busy: boolean; onClose: () => void; onValider: (mdp: string) => void },
) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const trop_court = p1.length > 0 && p1.length < 8;
  const differents = p2.length > 0 && p1 !== p2;
  const valide = p1.length >= 8 && p1 === p2;
  return (
    <Modal title={`Nouveau mot de passe — ${fullName(salarie)}`} onClose={onClose}>
      <p className="mut mb-4 text-[12.5px]">
        Identifiant : <b>{salarie.username}</b>. Son mot de passe actuel cessera de fonctionner.
        Ses sessions déjà ouvertes restent valides jusqu&apos;à une heure : pour couper l&apos;accès
        tout de suite, bloquez le compte avec l&apos;interrupteur Statut.
      </p>
      <Field label="Nouveau mot de passe">
        <input className="inp" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
      </Field>
      <Field label="Confirmer">
        <input className="inp" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
      </Field>
      {trop_court && <div className="mb-3 rounded-lg bg-err-l px-3 py-2 text-err">8 caractères minimum</div>}
      {differents && <div className="mb-3 rounded-lg bg-err-l px-3 py-2 text-err">Les deux mots de passe ne correspondent pas</div>}
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn-pri" disabled={busy || !valide} onClick={() => onValider(p1)}>Enregistrer</button>
      </div>
    </Modal>
  );
}

function Interrupteur({ on, disabled, onClick, title }: { on: boolean; disabled?: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} title={title} disabled={disabled} onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? "bg-pri" : "bg-[#cbd5e1]"}`}>
      <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${on ? "left-[25px]" : "left-[3px]"}`} />
    </button>
  );
}

/** Le mot de passe provisoire n'est affiché qu'une fois : il n'est jamais
 *  stocké en clair, seul son hash existe dans auth.users. */
function AccesCree({ acces, onClose }: { acces: Acces; onClose: () => void }) {
  const toast = useToast();
  const txt = `${acces.name} — identifiant : ${acces.username} — mot de passe provisoire : ${acces.temp_password}`;
  return (
    <Modal title="Accès créé" onClose={onClose}>
      <p className="mut mb-4 text-[12.5px]">
        À remettre en main propre. Ce mot de passe ne sera plus affiché après la fermeture de cette fenêtre.
      </p>
      <Field label="Salarié"><input className="inp" readOnly value={acces.name} /></Field>
      <Field label="Identifiant"><input className="inp" readOnly value={acces.username ?? ""} /></Field>
      <Field label="Mot de passe provisoire"><input className="inp font-mono" readOnly value={acces.temp_password ?? ""} /></Field>
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={() => { navigator.clipboard.writeText(txt); toast("Copié"); }}>Copier</button>
        <button className="btn-pri" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}

function NewRole({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState(roles[0]?.key ?? "brute");
  const [color, setColor] = useState("#be185d");
  const { busy, run } = useAction();
  const key = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return (
    <Modal title="Nouveau rôle" onClose={onClose}>
      <Field label="Nom du rôle"><input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. Superviseur qualité" /></Field>
      <Field label="Copier les droits de"><select className="inp" value={from} onChange={(e) => setFrom(e.target.value)}>{roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
      <Field label="Couleur"><input type="color" className="h-10 w-20 rounded border border-line" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
      <p className="mut mb-3 text-[12.5px]">Code : <code>{key || "—"}</code>. Le niveau d&apos;accès aux données (salarié / manager / RH) est hérité du rôle copié.</p>
      <div className="flex justify-end"><button className="btn-pri" disabled={busy || !key} onClick={() => run(async () => {
        must(await supabase.rpc("create_role", { p_key: key, p_label: label, p_copy_from: from, p_color: color })); onDone();
      }, "Rôle créé")}>Créer</button></div>
    </Modal>
  );
}
