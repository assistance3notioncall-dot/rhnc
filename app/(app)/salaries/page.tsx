"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Badge, Empty, Modal, PageHead, Tabs, useAction, useToast } from "@/components/ui";
import { SalaryChangeModal } from "@/components/SalaryChange";
import { FicheModal, type Row, type Role, type Dept } from "@/components/FicheSalarie";
import { dfr, dh, downloadCSV, fullName } from "@/lib/format";

type Cred = { name: string; username?: string; temp_password?: string; error?: string };

// Ordre de la liste : actifs en haut, puis bloqués, suspendus, puis sortis / inactifs (ordre du matricule conservé dans chaque groupe)
// Groupes : Direction, Back office, Agents, Entretien & logistique (profiles.groupe)
const GROUPS: [string, string][] = [["direction", "Direction"], ["back_office", "Back office"], ["agents", "Agents"], ["extra", "Entretien & logistique"]];
const groupRank = (g?: string) => { const i = GROUPS.findIndex(([k]) => k === g); return i < 0 ? GROUPS.length : i; };
const rank = (r: { status: string; account_status: string }) =>
  r.status === "actif" ? (r.account_status === "bloque" ? 1 : 0) : r.status === "suspendu" ? 2 : 3;

export default function Salaries() {
  const { me, can, isSuper } = useSession();
  const canEdit = can("salaries", true);
  const [rows, setRows] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  // Salaire de base visible (null = masqué par le super admin) et drapeau « masqué »
  const [salaries, setSalaries] = useState<Record<string, number | null>>({});
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [fRole, setFRole] = useState("");
  const [fAcc, setFAcc] = useState("tous");
  // Sortis (date de sortie passée ou statut « sorti ») : masqués de la liste active, consultables en historique
  const [showOut, setShowOut] = useState(false);
  const [exits, setExits] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<Record<string, string>>({});
  // Comptes hors effectif (direction, comptes techniques admin / RH) : pas de fiche salarié ni de paie
  const [hors, setHors] = useState<Record<string, boolean>>({});
  const [showHors, setShowHors] = useState(false);
  const [fGroup, setFGroup] = useState("tous");
  const [sel, setSel] = useState<string[]>([]);
  const [edit, setEdit] = useState<string | "new" | null>(null);
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [salFor, setSalFor] = useState<Row | null>(null);
  const [importing, setImporting] = useState(false);
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    const [{ data: r }, { data: ro }, { data: d }, { data: c }, { data: ex }] = await Promise.all([
      supabase.from("employees_access").select("*").order("matricule"),
      supabase.from("app_roles").select("key,label,kind,locked,color").order("label"),
      supabase.from("departments").select("id,name").order("name"),
      supabase.rpc("visible_base_salaries"),
      supabase.from("profiles").select("id,exit_date,groupe,hors_effectif"),
    ]);
    const px = (ex as { id: string; exit_date: string | null; groupe: string | null; hors_effectif: boolean }[] | null) ?? [];
    setHors(Object.fromEntries(px.map((x) => [x.id, !!x.hors_effectif])));
    setExits(Object.fromEntries(px.filter((x) => x.exit_date).map((x) => [x.id, x.exit_date as string])));
    setGroups(Object.fromEntries(px.map((x) => [x.id, x.groupe ?? "agents"])));
    setRows((r as Row[]) ?? []); setRoles((ro as Role[]) ?? []); setDepts((d as Dept[]) ?? []);
    const sal = (c as { profile_id: string; base_salary: number | null; hidden: boolean }[] | null) ?? [];
    setSalaries(Object.fromEntries(sal.map((x) => [x.profile_id, x.base_salary == null ? null : Number(x.base_salary)])));
    setHidden(Object.fromEntries(sal.map((x) => [x.profile_id, !!x.hidden])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const isOut = useCallback((r: Row) => hors[r.id] || r.status === "sorti" || r.status === "inactif" || (!!exits[r.id] && exits[r.id] < today), [exits, today, hors]);
  const horsCount = rows.filter((r) => hors[r.id]).length;
  const outCount = rows.filter((r) => isOut(r) && !hors[r.id]).length;
  const shown = useMemo(() => rows.filter((r) =>
    (showHors ? !!hors[r.id] : showOut ? isOut(r) && !hors[r.id] : !isOut(r)) && (fGroup === "tous" || groups[r.id] === fGroup) && (!q || `${r.first_name} ${r.last_name} ${r.username} ${r.matricule}`.toLowerCase().includes(q.toLowerCase())) &&
    (!fRole || r.role_key === fRole) && (fAcc === "tous" || r.account_status === fAcc),
  ).sort((a, b) => groupRank(groups[a.id]) - groupRank(groups[b.id]) || rank(a) - rank(b)), [rows, q, fRole, fAcc, showOut, showHors, hors, isOut, groups, fGroup]);
  const groupCount = (g: string) => rows.filter((r) => !isOut(r) && groups[r.id] === g).length;
  const cols = canEdit ? 11 : 10;
  const roleColor = (k: string | null) => roles.find((r) => r.key === k)?.color ?? "#64748b";
  const withoutAccess = shown.filter((r) => r.account_status === "sans_compte" && r.status === "actif");

  async function createAccess(ids: string[]) {
    await run(async () => {
      const { data, error } = await supabase.functions.invoke("create-access", { body: { profile_ids: ids } });
      if (error) { let m = error.message; try { m = (await (error as { context?: Response }).context?.json())?.error ?? m; } catch { /* */ } throw new Error(m); }
      setCreds(data.results as Cred[]); setSel([]); await load();
    });
  }
  async function hideSalaries(ids: string[], hide: boolean) {
    if (!ids.length) return;
    await run(async () => {
      must(await supabase.rpc("set_salary_hidden", { p_profiles: ids, p_hidden: hide })); await load();
    }, hide ? "Salaire masqué aux autres utilisateurs" : "Salaire de nouveau visible");
  }
  // Bloquer / supprimer : super admin, ou droit « Salariés » en modification — sauf Direction, RH, super admin et soi-même
  const canManage = (r: Row) => {
    if (r.id === me?.id) return false;
    if (isSuper) return true;
    const role = roles.find((x) => x.key === r.role_key);
    return canEdit && !role?.locked && !["rh", "admin"].includes(role?.kind ?? "salarie");
  };
  const salaryCell = (id: string) => salaries[id] != null ? dh(salaries[id]) : hidden[id] ? "Masqué" : "—";
  async function deleteEmployee(r: Row) {
    const name = fullName(r);
    if (!confirm(`Supprimer définitivement ${name} ?\n\nSa fiche, son accès au site, ses bulletins de paie, documents et demandes seront supprimés. Cette action est irréversible.`)) return;
    if (prompt(`Pour confirmer, tapez son identifiant : ${r.username}`)?.trim().toLowerCase() !== (r.username ?? "").toLowerCase()) return;
    await run(async () => {
      must(await supabase.rpc("delete_employee", { p_profile: r.id })); await load();
    }, `${name} a été supprimé(e)`);
  }
  async function setBlocked(r: Row, block: boolean) {
    // Bloquer = fiche « bloquée » + compte banni + déconnexion immédiate (fonction set_account_blocked)
    await run(async () => { must(await supabase.rpc("set_account_blocked", { p_profile: r.id, p_block: block })); await load(); }, block ? "Accès bloqué — la personne est déconnectée" : "Accès débloqué");
  }

  return (
    <Guard module="salaries">
      <PageHead title="Salariés" sub={`${rows.length - outCount - horsCount} fiches actives · ${rows.filter((r) => r.account_status === "actif").length} avec accès · ${outCount} sorti(s)`}>
        <button className="btn" onClick={() => downloadCSV("salaries.csv", shown.map(({ id: _id, ...r }) => ({ ...r, salaire_base: salaries[_id] ?? (hidden[_id] ? "masqué" : "") })))}>Export CSV</button>
        {isSuper && <button className="btn" disabled={busy} title="Masquer le salaire de base des fiches affichées aux autres utilisateurs (RH, direction, managers)"
          onClick={() => confirm(`Masquer le salaire de base de ${shown.length} fiche(s) aux autres utilisateurs ?`) && hideSalaries(shown.map((r) => r.id), true)}>🔒 Masquer les salaires</button>}
        {isSuper && shown.some((r) => hidden[r.id]) && <button className="btn" disabled={busy}
          onClick={() => hideSalaries(shown.filter((r) => hidden[r.id]).map((r) => r.id), false)}>🔓 Tout afficher</button>}
        {canEdit && <button className="btn" onClick={() => setImporting(true)}>Importer CSV</button>}
        {canEdit && <button className="btn-pri" onClick={() => setEdit("new")}>+ Nouvelle fiche</button>}
      </PageHead>
      <div className="mb-3"><Tabs value={fGroup} onChange={setFGroup} tabs={[{ key: "tous", label: "Tous les groupes" }, ...GROUPS.map(([k, l]) => ({ key: k, label: `${l} (${groupCount(k)})` }))]} /></div>
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <input className="inp sm:max-w-xs" placeholder="Rechercher (nom, identifiant, matricule)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp w-auto" value={fRole} onChange={(e) => setFRole(e.target.value)}>
          <option value="">Tous les rôles</option>{roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <Tabs value={fAcc} onChange={setFAcc} tabs={[{ key: "tous", label: "Tous" }, { key: "sans_compte", label: "Sans accès" }, { key: "actif", label: "Accès actif" }, { key: "bloque", label: "Bloqués" }]} />
        <button className={`btn btn-sm ${showOut ? "border-pri text-pri-d" : ""}`} onClick={() => { setShowOut(!showOut); setShowHors(false); }}>
          {showOut ? "← Retour aux actifs" : `Historique des sortis (${outCount})`}</button>
        {(isSuper || canEdit) && horsCount > 0 && <button className={`btn btn-sm ${showHors ? "border-pri text-pri-d" : ""}`} title="Direction et comptes techniques : accès au site sans fiche salarié ni paie"
          onClick={() => { setShowHors(!showHors); setShowOut(false); }}>{showHors ? "← Retour aux salariés" : `Comptes hors effectif (${horsCount})`}</button>}
        {canEdit && (
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {sel.length > 0 && <button className="btn-pri" disabled={busy} onClick={() => createAccess(sel)}>Créer l&apos;accès ({sel.length})</button>}
            {sel.length === 0 && withoutAccess.length > 0 && <button className="btn" disabled={busy} onClick={() => confirm(`Créer l'accès pour ${withoutAccess.length} salarié(s) ?`) && createAccess(withoutAccess.map((r) => r.id))}>Créer tous les accès manquants ({withoutAccess.length})</button>}
          </div>
        )}
      </div>
      <div className="card overflow-x-auto p-0">
        {shown.length === 0 ? <Empty>Aucun salarié.</Empty> : (
          <table className="tbl">
            <thead><tr>
              {canEdit && <th className="w-8"><input type="checkbox" checked={sel.length > 0 && sel.length === withoutAccess.length} onChange={(e) => setSel(e.target.checked ? withoutAccess.map((r) => r.id) : [])} /></th>}
              <th>Mat.</th><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Section</th><th>Embauche</th><th className="text-right">Salaire base</th><th>Accès</th><th />
            </tr></thead>
            <tbody>{shown.map((r, i) => (<Fragment key={r.id}>
              {(i === 0 || groups[shown[i - 1].id] !== groups[r.id]) && (
                <tr className="bg-gray2-l"><td colSpan={cols} className="py-1.5 text-[12px] font-bold uppercase tracking-wide text-pri-d">
                  {GROUPS.find(([k]) => k === groups[r.id])?.[1] ?? "Sans groupe"} <span className="mut font-normal normal-case">· {shown.filter((x) => groups[x.id] === groups[r.id]).length}</span></td></tr>)}
              <tr className={r.status !== "actif" ? "opacity-50" : ""}>
                {canEdit && <td>{r.account_status === "sans_compte" && r.status === "actif" && (
                  <input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} />)}</td>}
                <td className="mut">{r.matricule}</td>
                <td className="font-medium">{fullName(r)}</td>
                <td className="mut">@{r.username}</td>
                <td><span className="badge" style={{ background: roleColor(r.role_key) + "1f", color: roleColor(r.role_key) }}>{r.role_label}</span></td>
                <td>{r.section}</td>
                <td className="mut whitespace-nowrap">{dfr(r.hire_date)}{exits[r.id] && <div className="text-[11.5px] text-warn">sortie {dfr(exits[r.id])}</div>}</td>
                <td className="whitespace-nowrap text-right">
                  <span className={salaries[r.id] == null && hidden[r.id] ? "mut italic" : ""}>{salaryCell(r.id)}</span>
                  {isSuper ? (
                    <button className={`btn btn-sm ml-1.5 px-1.5 ${hidden[r.id] ? "border-warn text-warn" : "opacity-50"}`} disabled={busy}
                      title={hidden[r.id] ? "Masqué aux autres utilisateurs — cliquer pour l'afficher" : "Visible — cliquer pour le masquer aux autres utilisateurs"}
                      onClick={() => hideSalaries([r.id], !hidden[r.id])}>{hidden[r.id] ? "🔒" : "🔓"}</button>
                  ) : hidden[r.id] && salaries[r.id] == null ? <span className="ml-1" title="Masqué par le super admin">🔒</span> : null}
                </td>
                <td><Badge status={r.account_status} /></td>
                <td className="whitespace-nowrap text-right">
                  {canEdit && <button className="btn btn-sm" onClick={() => setEdit(r.id)}>Fiche</button>}
                  {can("salaire_base") && r.id !== me?.id && (isSuper || !hidden[r.id]) && <button className="btn btn-sm ml-1" onClick={() => setSalFor(r)}>Salaire</button>}
                  {canEdit && r.account_status === "sans_compte" && r.status === "actif" && <button className="btn-pri btn-sm ml-1" disabled={busy} onClick={() => createAccess([r.id])}>Créer l&apos;accès</button>}
                  {canManage(r) && r.account_status === "actif" && <button className="btn-no btn-sm ml-1" disabled={busy} onClick={() => confirm(`Bloquer l'accès de ${fullName(r)} ?`) && setBlocked(r, true)}>Bloquer</button>}
                  {canManage(r) && r.account_status === "bloque" && <button className="btn-ok btn-sm ml-1" disabled={busy} onClick={() => setBlocked(r, false)}>Débloquer</button>}
                  {canManage(r) && <button className="btn-no btn-sm ml-1" disabled={busy} title="Supprimer définitivement la fiche et l'accès" onClick={() => deleteEmployee(r)}>Supprimer</button>}
                </td>
              </tr></Fragment>))}
            </tbody>
          </table>
        )}
      </div>

      {edit && <FicheModal id={edit === "new" ? null : edit} salary={edit === "new" ? null : salaryCell(edit)} roles={roles} depts={depts} people={rows} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
      {salFor && <SalaryChangeModal person={{ id: salFor.id, name: fullName(salFor) }} current={salaries[salFor.id] ?? undefined} onClose={() => setSalFor(null)} onDone={() => { setSalFor(null); load(); }} />}
      {creds && <CredsModal creds={creds} onClose={() => setCreds(null)} />}
      {importing && <ImportModal roles={roles} depts={depts} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
    </Guard>
  );
}


function CredsModal({ creds, onClose }: { creds: Cred[]; onClose: () => void }) {
  const toast = useToast();
  const ok = creds.filter((c) => c.temp_password);
  const txt = ok.map((c) => `${c.name} — identifiant : ${c.username} — mot de passe provisoire : ${c.temp_password}`).join("\n");
  return (
    <Modal title={`Accès créés (${ok.length})`} onClose={onClose} wide>
      <p className="mb-3 rounded-lg bg-warn-l px-3 py-2 text-warn">Ces mots de passe ne seront plus affichés. Remettez-les en main propre : chacun choisira le sien à la 1re connexion.</p>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Salarié</th><th>Identifiant</th><th>Mot de passe provisoire</th></tr></thead>
          <tbody>{creds.map((c, i) => (
            <tr key={i}><td>{c.name}</td><td>{c.username}</td>
              <td>{c.temp_password ? <code className="rounded-sm bg-gray2-l px-2 py-0.5 font-mono">{c.temp_password}</code> : <span className="text-err">{c.error}</span>}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn" onClick={() => { navigator.clipboard.writeText(txt); toast("Copié"); }}>Copier</button>
        <button className="btn-pri" onClick={() => downloadCSV("acces_rh360.csv", ok.map((c) => ({ salarie: c.name, identifiant: c.username, mot_de_passe_provisoire: c.temp_password })))}>Télécharger (CSV)</button>
      </div>
    </Modal>
  );
}

function ImportModal({ roles, depts, onClose, onDone }: { roles: Role[]; depts: Dept[]; onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const [text, setText] = useState("matricule;identifiant;prenom;nom;role;section;embauche;salaire\n");
  const { busy, run } = useAction();
  const lines = text.trim().split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(/[;,\t]/).map((x) => x.trim()));
  return (
    <Modal title="Importer des fiches (CSV)" onClose={onClose} wide>
      <p className="mut mb-2">Une ligne par salarié. Rôles possibles : {roles.filter((r) => !r.locked).map((r) => r.key).join(", ")}. Sections : {depts.map((d) => d.name).join(", ")}. Date au format AAAA-MM-JJ.</p>
      <textarea className="inp font-mono text-[12.5px]" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="mut my-2">{lines.length} ligne(s) détectée(s).</p>
      <div className="flex justify-end">
        <button className="btn-pri" disabled={busy || !lines.length} onClick={() => run(async () => {
          for (const [matricule, username, first_name, last_name, role_key, section, hire, salary] of lines) {
            const created = must(await supabase.from("profiles").insert({
              company_id: me!.company_id, matricule: matricule || null, username: (username || "").toLowerCase(), first_name, last_name: last_name ?? "",
              role_key: role_key || "brute", department_id: depts.find((d) => d.name.toLowerCase() === (section ?? "").toLowerCase())?.id ?? null,
              hire_date: hire || null,
            }).select("id").single()) as { id: string };
            must(await supabase.from("employee_compensation").upsert({ profile_id: created.id, base_salary: Number(salary) || 0 }));
          }
          onDone();
        }, `${lines.length} fiche(s) importée(s)`)}>Importer</button>
      </div>
    </Modal>
  );
}
