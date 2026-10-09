"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Badge, Empty, Field, Modal, PageHead, Tabs, useAction, useToast } from "@/components/ui";
import { SalaryChangeModal } from "@/components/SalaryChange";
import { dfr, dh, downloadCSV, fullName } from "@/lib/format";

type Row = { id: string; matricule: string | null; first_name: string; last_name: string; username: string | null; email: string | null; role_key: string | null; role_label: string | null; section: string | null; hire_date: string | null; status: string; account_status: string };
type Role = { key: string; label: string; kind: string; locked: boolean; color: string };
type Dept = { id: string; name: string };
type Cred = { name: string; username?: string; temp_password?: string; error?: string };

export default function Salaries() {
  const { me, can, isSuper } = useSession();
  const canEdit = can("salaries", true);
  const [rows, setRows] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [salaries, setSalaries] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [fRole, setFRole] = useState("");
  const [fAcc, setFAcc] = useState("tous");
  const [sel, setSel] = useState<string[]>([]);
  const [edit, setEdit] = useState<string | "new" | null>(null);
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [salFor, setSalFor] = useState<Row | null>(null);
  const [importing, setImporting] = useState(false);
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    const [{ data: r }, { data: ro }, { data: d }, { data: c }] = await Promise.all([
      supabase.from("employees_access").select("*").order("matricule"),
      supabase.from("app_roles").select("key,label,kind,locked,color").order("label"),
      supabase.from("departments").select("id,name").order("name"),
      supabase.from("employee_compensation").select("profile_id,base_salary"),
    ]);
    setRows((r as Row[]) ?? []); setRoles((ro as Role[]) ?? []); setDepts((d as Dept[]) ?? []);
    setSalaries(Object.fromEntries((c ?? []).map((x) => [x.profile_id, Number(x.base_salary)])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => rows.filter((r) =>
    (!q || `${r.first_name} ${r.last_name} ${r.username} ${r.matricule}`.toLowerCase().includes(q.toLowerCase())) &&
    (!fRole || r.role_key === fRole) && (fAcc === "tous" || r.account_status === fAcc),
  ), [rows, q, fRole, fAcc]);
  const roleColor = (k: string | null) => roles.find((r) => r.key === k)?.color ?? "#64748b";
  const withoutAccess = shown.filter((r) => r.account_status === "sans_compte" && r.status === "actif");

  async function createAccess(ids: string[]) {
    await run(async () => {
      const { data, error } = await supabase.functions.invoke("create-access", { body: { profile_ids: ids } });
      if (error) { let m = error.message; try { m = (await (error as { context?: Response }).context?.json())?.error ?? m; } catch { /* */ } throw new Error(m); }
      setCreds(data.results as Cred[]); setSel([]); await load();
    });
  }
  async function setBlocked(r: Row, block: boolean) {
    await run(async () => { must(await supabase.from("profiles").update({ account_status: block ? "bloque" : "actif" }).eq("id", r.id)); await load(); }, block ? "Accès bloqué" : "Accès débloqué");
  }

  return (
    <Guard module="salaries">
      <PageHead title="Salariés" sub={`${rows.length} fiches · ${rows.filter((r) => r.account_status === "actif").length} avec accès`}>
        <button className="btn" onClick={() => downloadCSV("salaries.csv", shown.map(({ id: _id, ...r }) => ({ ...r, salaire_base: salaries[_id] ?? "" })))}>Export CSV</button>
        {canEdit && <button className="btn" onClick={() => setImporting(true)}>Importer CSV</button>}
        {canEdit && <button className="btn-pri" onClick={() => setEdit("new")}>+ Nouvelle fiche</button>}
      </PageHead>
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <input className="inp max-w-xs" placeholder="Rechercher (nom, identifiant, matricule)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp w-auto" value={fRole} onChange={(e) => setFRole(e.target.value)}>
          <option value="">Tous les rôles</option>{roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <Tabs value={fAcc} onChange={setFAcc} tabs={[{ key: "tous", label: "Tous" }, { key: "sans_compte", label: "Sans accès" }, { key: "actif", label: "Accès actif" }, { key: "bloque", label: "Bloqués" }]} />
        {canEdit && (
          <div className="ml-auto flex gap-2">
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
            <tbody>{shown.map((r) => (
              <tr key={r.id} className={r.status !== "actif" ? "opacity-50" : ""}>
                {canEdit && <td>{r.account_status === "sans_compte" && r.status === "actif" && (
                  <input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} />)}</td>}
                <td className="mut">{r.matricule}</td>
                <td className="font-medium">{fullName(r)}</td>
                <td className="mut">@{r.username}</td>
                <td><span className="badge" style={{ background: roleColor(r.role_key) + "1f", color: roleColor(r.role_key) }}>{r.role_label}</span></td>
                <td>{r.section}</td>
                <td className="mut">{dfr(r.hire_date)}</td>
                <td className="text-right">{salaries[r.id] != null ? dh(salaries[r.id]) : "—"}</td>
                <td><Badge status={r.account_status} /></td>
                <td className="whitespace-nowrap text-right">
                  {canEdit && <button className="btn btn-sm" onClick={() => setEdit(r.id)}>Fiche</button>}
                  {can("salaire_base") && r.id !== me?.id && <button className="btn btn-sm ml-1" onClick={() => setSalFor(r)}>Salaire</button>}
                  {canEdit && r.account_status === "sans_compte" && r.status === "actif" && <button className="btn-pri btn-sm ml-1" disabled={busy} onClick={() => createAccess([r.id])}>Créer l&apos;accès</button>}
                  {isSuper && r.account_status === "actif" && r.id !== me?.id && <button className="btn-no btn-sm ml-1" disabled={busy} onClick={() => confirm(`Bloquer l'accès de ${fullName(r)} ?`) && setBlocked(r, true)}>Bloquer</button>}
                  {isSuper && r.account_status === "bloque" && <button className="btn-ok btn-sm ml-1" disabled={busy} onClick={() => setBlocked(r, false)}>Débloquer</button>}
                </td>
              </tr>))}
            </tbody>
          </table>
        )}
      </div>

      {edit && <FicheModal id={edit === "new" ? null : edit} roles={roles} depts={depts} people={rows} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
      {salFor && <SalaryChangeModal person={{ id: salFor.id, name: fullName(salFor) }} current={salaries[salFor.id]} onClose={() => setSalFor(null)} onDone={() => { setSalFor(null); load(); }} />}
      {creds && <CredsModal creds={creds} onClose={() => setCreds(null)} />}
      {importing && <ImportModal roles={roles} depts={depts} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
    </Guard>
  );
}

const EMPTY = {
  matricule: "", username: "", first_name: "", last_name: "", role_key: "brute", department_id: "", manager_id: "", job_title: "", hire_date: "",
  contract_type: "CDI", contract_end: "", trial_end: "", cin: "", phone: "", email: "", birth_date: "", family_status: "", children_count: 0, address: "", emergency_contact: "", status: "actif",
};
const COMP = { base_salary: 0, transport_allowance: 0, meal_allowance: 0, attendance_bonus: 0, cnss_number: "", rib: "" };

function FicheModal({ id, roles, depts, people, onClose, onDone }: { id: string | null; roles: Role[]; depts: Dept[]; people: Row[]; onClose: () => void; onDone: () => void }) {
  const { me, isSuper } = useSession();
  const [f, setF] = useState<typeof EMPTY>(EMPTY);
  const [c, setC] = useState<typeof COMP>(COMP);
  const { busy, run } = useAction();
  useEffect(() => {
    if (!id) return;
    supabase.from("profiles").select("*").eq("id", id).single().then(({ data }) => data && setF(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, data[k] ?? (k === "children_count" ? 0 : "")])) as typeof EMPTY));
    supabase.from("employee_compensation").select("*").eq("profile_id", id).maybeSingle().then(({ data }) => data && setC(Object.fromEntries(Object.keys(COMP).map((k) => [k, data[k] ?? ""])) as typeof COMP));
  }, [id]);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const setc = (k: keyof typeof COMP) => (e: React.ChangeEvent<HTMLInputElement>) => setC({ ...c, [k]: e.target.value });
  const nn = (v: unknown) => (v === "" ? null : v);
  const sensitive = (k: string) => { const r = roles.find((x) => x.key === k); return !!r && (r.locked || r.kind === "rh" || r.kind === "admin"); };

  async function save() {
    await run(async () => {
      const row: Record<string, unknown> = {
        ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, nn(v)])),
        username: f.username.trim().toLowerCase(), children_count: Number(f.children_count) || 0, company_id: me!.company_id,
      };
      const comp = { transport_allowance: Number(c.transport_allowance) || 0, meal_allowance: Number(c.meal_allowance) || 0, attendance_bonus: Number(c.attendance_bonus) || 0, cnss_number: nn(c.cnss_number), rib: nn(c.rib) };
      if (id) {
        if (!row.email) delete row.email; // ne jamais vider l'e-mail de connexion
        must(await supabase.from("profiles").update(row).eq("id", id));
        must(await supabase.from("employee_compensation").upsert({ profile_id: id, ...comp }));
      } else {
        const created = must(await supabase.from("profiles").insert(row).select("id").single()) as { id: string };
        must(await supabase.from("employee_compensation").upsert({ profile_id: created.id, base_salary: Number(c.base_salary) || 0, ...comp }));
      }
      onDone();
    }, id ? "Fiche mise à jour" : "Fiche créée — vous pouvez maintenant créer son accès");
  }

  return (
    <Modal title={id ? `Fiche — ${f.first_name} ${f.last_name}` : "Nouvelle fiche salarié"} onClose={onClose} wide>
      <h3 className="mb-2">Identité & poste</h3>
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field label="Matricule"><input className="inp" value={f.matricule} onChange={set("matricule")} /></Field>
        <Field label="Prénom *"><input className="inp" value={f.first_name} onChange={set("first_name")} /></Field>
        <Field label="Nom"><input className="inp" value={f.last_name} onChange={set("last_name")} /></Field>
        <Field label="Identifiant de connexion *"><input className="inp" value={f.username} disabled={!!id && !isSuper} placeholder="ex. ayoub" onChange={set("username")} /></Field>
        <Field label="Rôle"><select className="inp" value={f.role_key} disabled={!!id && !isSuper} onChange={set("role_key")}>
          {roles.filter((r) => isSuper || !sensitive(r.key)).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
        <Field label="Section"><select className="inp" value={f.department_id} onChange={set("department_id")}>
          <option value="">—</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Responsable"><select className="inp" value={f.manager_id} onChange={set("manager_id")}>
          <option value="">—</option>{people.filter((p) => p.id !== id && p.status === "actif").map((p) => <option key={p.id} value={p.id}>{fullName(p)}</option>)}</select></Field>
        <Field label="Poste"><input className="inp" value={f.job_title} onChange={set("job_title")} /></Field>
        <Field label="Statut"><select className="inp" value={f.status} onChange={set("status")}><option value="actif">Actif</option><option value="suspendu">Suspendu</option><option value="sorti">Sorti</option></select></Field>
      </div>
      <h3 className="mb-2 mt-2">Contrat</h3>
      <div className="grid gap-x-3 sm:grid-cols-4">
        <Field label="Type"><select className="inp" value={f.contract_type} onChange={set("contract_type")}>{["CDI", "CDD", "ANAPEC", "stage", "interim"].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Embauche"><input type="date" className="inp" value={f.hire_date} onChange={set("hire_date")} /></Field>
        <Field label="Fin d'essai"><input type="date" className="inp" value={f.trial_end} onChange={set("trial_end")} /></Field>
        <Field label="Fin de contrat"><input type="date" className="inp" value={f.contract_end} onChange={set("contract_end")} /></Field>
      </div>
      <h3 className="mb-2 mt-2">Coordonnées & famille</h3>
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field label="CIN"><input className="inp" value={f.cin} onChange={set("cin")} /></Field>
        <Field label="Téléphone"><input className="inp" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="E-mail (facultatif)"><input className="inp" value={f.email ?? ""} onChange={set("email")} /></Field>
        <Field label="Date de naissance"><input type="date" className="inp" value={f.birth_date} onChange={set("birth_date")} /></Field>
        <Field label="Situation familiale"><select className="inp" value={f.family_status} onChange={set("family_status")}><option value="">—</option><option>Célibataire</option><option>Marié(e)</option><option>Divorcé(e)</option><option>Veuf(ve)</option></select></Field>
        <Field label="Enfants à charge"><input type="number" min={0} className="inp" value={f.children_count} onChange={set("children_count")} /></Field>
        <Field label="Adresse" className="sm:col-span-2"><input className="inp" value={f.address} onChange={set("address")} /></Field>
        <Field label="Contact d'urgence"><input className="inp" value={f.emergency_contact} onChange={set("emergency_contact")} /></Field>
      </div>
      <h3 className="mb-2 mt-2">Rémunération</h3>
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field label={id ? "Salaire de base (via « Salaire »)" : "Salaire de base (DH brut)"}><input type="number" className="inp" disabled={!!id} value={c.base_salary} onChange={setc("base_salary")} /></Field>
        <Field label="Prime d'assiduité (DH)"><input type="number" className="inp" value={c.attendance_bonus} onChange={setc("attendance_bonus")} /></Field>
        <Field label="Indemnité transport"><input type="number" className="inp" value={c.transport_allowance} onChange={setc("transport_allowance")} /></Field>
        <Field label="Indemnité panier"><input type="number" className="inp" value={c.meal_allowance} onChange={setc("meal_allowance")} /></Field>
        <Field label="N° CNSS"><input className="inp" value={c.cnss_number} onChange={setc("cnss_number")} /></Field>
        <Field label="RIB"><input className="inp" value={c.rib} onChange={setc("rib")} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn-pri" disabled={busy || !f.first_name || !/^[a-z0-9.]+$/.test(f.username.trim().toLowerCase())} onClick={save}>Enregistrer</button>
      </div>
    </Modal>
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
              <td>{c.temp_password ? <code className="rounded bg-gray2-l px-2 py-0.5 font-mono">{c.temp_password}</code> : <span className="text-err">{c.error}</span>}</td></tr>
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
              hire_date: hire || null, job_title: roles.find((r) => r.key === (role_key || "brute"))?.label ?? null,
            }).select("id").single()) as { id: string };
            must(await supabase.from("employee_compensation").upsert({ profile_id: created.id, base_salary: Number(salary) || 0 }));
          }
          onDone();
        }, `${lines.length} fiche(s) importée(s)`)}>Importer</button>
      </div>
    </Modal>
  );
}
