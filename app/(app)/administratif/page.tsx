"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Empty, Field, Modal, PageHead, Tabs, useAction } from "@/components/ui";
import { dfr, dh, downloadCSV, fullName } from "@/lib/format";
import { BankSelect } from "@/components/BankSelect";
import { FicheModal as FicheSalarie, type Row as SalRow, type Role, type Dept } from "@/components/FicheSalarie";

// Onglet « Suivi Administratif » : informations administratives du personnel (ex-feuille Notion Workforce).
// Accès réglé par rôle dans Utilisateurs & rôles : « voir » = consulter, « modifier » = changer statut, contrat, banque.
// Même regroupement que Paie et Salariés (profiles.groupe).
const GROUPS: [string, string][] = [["direction", "Direction"], ["back_office", "Back office"], ["agents", "Agents"], ["extra", "Entretien & logistique"]];
const groupRank = (g: string) => { const i = GROUPS.findIndex(([k]) => k === g); return i < 0 ? GROUPS.length : i; };
const groupLabel = (g: string) => GROUPS.find(([k]) => k === g)?.[1] ?? "Sans groupe";
const STATUS_RANK: Record<string, number> = { actif: 0, suspendu: 1, inactif: 2, sorti: 3 };
// Deux choix seulement : Actif / Inactif (suspendu et sorti en base s'affichent « Inactif »)
const STATUS_LABEL: Record<string, string> = { actif: "Actif", inactif: "Inactif" };
const simple = (s: string) => (s === "actif" ? "actif" : "inactif");

type Row = {
  id: string; first_name: string; last_name: string; matricule: string | null; cin: string | null; address: string | null;
  birth_date: string | null; phone: string | null; emergency_contact: string | null; hire_date: string | null;
  status: string; groupe: string | null; contract_signed: boolean | null; validation_date: string | null;
};
type Line = Row & { g: string; cnss: string | null; rib: string | null; bank: string | null; cnssOk: boolean };

export default function Administratif() {
  const { can, isSuper } = useSession();
  const canView = can("administratif");
  const canEdit = can("administratif", true);
  const [lines, setLines] = useState<Line[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [fGroup, setFGroup] = useState("tous");
  const [fStatus, setFStatus] = useState("actifs");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Line | null>(null);
  const [adding, setAdding] = useState(false);
  // Super admin : fiche complète de Salariés (avec salaire) pour voir / ajouter tout le monde
  const [ref, setRef] = useState<{ roles: Role[]; depts: Dept[]; people: SalRow[]; salaries: Record<string, number | null> }>({ roles: [], depts: [], people: [], salaries: {} });
  const [cree, setCree] = useState<{ name: string; username: string; password: string } | null>(null);
  const { busy, run } = useAction();
  const setStatus = (l: Line, v: string) => {
    if (v === simple(l.status)) return;
    if (v !== "actif" && !confirm(`Passer ${fullName(l)} en « ${STATUS_LABEL[v]} » ? Son accès au site sera coupé.`)) return;
    run(async () => {
      must(await supabase.rpc("set_admin_status", { p_profile: l.id, p_status: v }));
      setLines((x) => x.map((y) => (y.id === l.id ? { ...y, status: v } : y)));
    }, "Statut enregistré");
  };
  const setContract = (l: Line, v: boolean) => run(async () => {
    must(await supabase.rpc("set_admin_info", { p_profile: l.id, p_bank: l.bank ?? "", p_contract_signed: v }));
    setLines((x) => x.map((y) => (y.id === l.id ? { ...y, contract_signed: v } : y)));
  }, "Contrat enregistré");
  const setCnss = (l: Line, v: boolean) => run(async () => {
    must(await supabase.rpc("set_admin_cnss", { p_profile: l.id, p_declared: v }));
    setLines((x) => x.map((y) => (y.id === l.id ? { ...y, cnssOk: v } : y)));
  }, "CNSS enregistrée");

  const loadRef = useCallback(async () => {
    const [{ data: ro }, { data: d }, { data: pe }, { data: sa }] = await Promise.all([
      supabase.from("app_roles").select("key,label,kind,locked,color").order("label"),
      supabase.from("departments").select("id,name").order("name"),
      supabase.from("employees_access").select("*").order("matricule"),
      supabase.rpc("visible_base_salaries"),
    ]);
    const sal = Object.fromEntries((((sa as { profile_id: string; base_salary: number | null }[]) ?? [])).map((x) => [x.profile_id, x.base_salary == null ? null : Number(x.base_salary)]));
    setRef({ roles: (ro as Role[]) ?? [], depts: (d as Dept[]) ?? [], people: (pe as SalRow[]) ?? [], salaries: sal });
  }, []);
  useEffect(() => { if (isSuper) loadRef(); }, [isSuper, loadRef]);

  const load = useCallback(async () => {
    // Fonction en base : vérifie le droit « voir » et exclut les comptes hors effectif
    const { data } = await supabase.rpc("admin_roster");
    setLines(((data as (Row & { cnss_number: string | null; rib: string | null; bank_name: string | null; cnss_declared: boolean | null })[]) ?? []).map((r) => (
      { ...r, g: r.groupe ?? "agents", cnss: r.cnss_number, rib: r.rib, bank: r.bank_name, cnssOk: !!r.cnss_declared })));
    setLoaded(true);
  }, []);
  useEffect(() => { if (canView) load(); }, [canView, load]);

  const needle = q.trim().toLowerCase();
  const byStatus = lines.filter((l) => fStatus === "tous" || (fStatus === "actifs" ? l.status === "actif" : l.status !== "actif"));
  const shown = byStatus
    .filter((l) => fGroup === "tous" || l.g === fGroup)
    .filter((l) => !needle || [fullName(l), l.cin, l.phone, l.matricule].some((v) => (v ?? "").toLowerCase().includes(needle)))
    // Dans chaque section : contrat « Oui » en haut, « Pas encore » en bas (re-trié dès qu'on change le contrat)
    .sort((a, b) => groupRank(a.g) - groupRank(b.g)
      || Number(!!b.contract_signed) - Number(!!a.contract_signed)
      || (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
      || fullName(a).localeCompare(fullName(b)));
  const count = (g: string) => byStatus.filter((l) => l.g === g).length;

  const exportCSV = () => downloadCSV(`administratif-${new Date().toISOString().slice(0, 10)}.csv`, shown.map((l) => ({
    groupe: groupLabel(l.g), statut: STATUS_LABEL[simple(l.status)], nom: fullName(l), cin: l.cin ?? "", adresse: l.address ?? "",
    ddn: l.birth_date ? dfr(l.birth_date) : "", contact: l.phone ?? "", urgence: l.emergency_contact ?? "", cnss: l.cnss ?? "",
    rib: l.rib ?? "", banque: l.bank ?? "", date_rentree: l.hire_date ? dfr(l.hire_date) : "", date_validation: l.validation_date ? dfr(l.validation_date) : "", contrat: l.contract_signed ? "oui" : "pas encore", cnss_declaree: l.cnssOk ? "oui" : "non",
  })));

  const cell = (v: string | null | undefined, cls = "") => <td className={cls}>{v ? v : <span className="text-mut">—</span>}</td>;

  return (
    <Guard module="administratif">
      <PageHead title="Suivi Administratif" sub="Informations administratives du personnel : identité, coordonnées, CNSS, banque et contrat.">
        <input className="inp w-56" placeholder="Rechercher (nom, CIN, tél.)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp w-auto" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="actifs">Actifs</option><option value="inactifs">Inactifs</option><option value="tous">Tous</option>
        </select>
        <button className="btn" disabled={!shown.length} onClick={exportCSV}>Exporter (CSV)</button>
        {canEdit && <button className="btn-pri" onClick={() => setAdding(true)}>{isSuper ? "+ Ajouter" : "+ Ajouter un agent"}</button>}
      </PageHead>
      {loaded && lines.length > 0 && (
        <Tabs value={fGroup} onChange={setFGroup} tabs={[{ key: "tous", label: `Tous (${byStatus.length})` },
          ...GROUPS.map(([k, l]) => ({ key: k, label: `${l} (${count(k)})` })).filter((t) => !t.label.endsWith("(0)"))]} />
      )}
      <div className="card max-h-[calc(100vh-9rem)] overflow-auto p-0">
        {!loaded ? <Empty>Chargement…</Empty> : shown.length === 0 ? <Empty>Aucun salarié pour ce filtre.</Empty> : (
          <table className="tbl text-[13px] [&_td]:whitespace-nowrap [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:shadow-[inset_0_-1px_0_#e5e7eb]">
            <thead>
              <tr className="[&_th]:text-[11px]">
                <th className="sticky left-0 z-20 bg-[#fafbfd]">Salarié</th>
                <th>Statut</th><th /><th>Date de rentrée</th><th>Date de validation</th><th>Contrat</th><th>CNSS</th>
              </tr>
            </thead>
            <tbody>{shown.map((l, i) => {
              const head = i === 0 || shown[i - 1].g !== l.g;
              return (<Fragment key={l.id}>
                {head && (
                  <tr className="bg-gray2-l text-[12px]">
                    <td colSpan={7} className="sticky left-0 z-[1] bg-gray2-l py-1.5 font-bold uppercase tracking-wide text-pri-d">
                      {groupLabel(l.g)} <span className="mut font-normal normal-case">· {shown.filter((x) => x.g === l.g).length}</span>
                    </td>
                  </tr>)}
                <tr>
                  <td className="sticky left-0 z-[1] bg-white">
                    <div className="font-medium">{fullName(l)}</div>
                    {l.matricule && <div className="mut text-[11.5px]">{l.matricule}</div>}
                  </td>
                  <td>
                    <select className={`inp w-auto py-1 text-[12.5px] ${l.status === "actif" ? "text-ok" : "text-mut"}`} disabled={busy || !canEdit} value={simple(l.status)} onChange={(e) => setStatus(l, e.target.value)}>
                      {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><button className="btn btn-sm" onClick={() => setEdit(l)}>Fiche</button></td>
                  {cell(l.hire_date ? dfr(l.hire_date) : null)}
                  {cell(l.validation_date ? dfr(l.validation_date) : null)}
                  <td>
                    <select className={`inp w-auto py-1 text-[12.5px] ${l.contract_signed ? "text-ok" : "text-warn"}`} disabled={busy || !canEdit} value={l.contract_signed ? "oui" : "non"} onChange={(e) => setContract(l, e.target.value === "oui")}>
                      <option value="oui">Oui</option><option value="non">Pas encore</option>
                    </select>
                  </td>
                  <td>
                    <select className={`inp w-auto py-1 text-[12.5px] ${l.cnssOk ? "text-ok" : "text-warn"}`} disabled={busy || !canEdit} value={l.cnssOk ? "oui" : "non"} onChange={(e) => setCnss(l, e.target.value === "oui")}>
                      <option value="oui">Oui</option><option value="non">Non</option>
                    </select>
                  </td>
                </tr>
              </Fragment>);
            })}</tbody>
          </table>
        )}
      </div>
      {edit && (isSuper
        ? <FicheSalarie id={edit.id} salary={ref.salaries[edit.id] != null ? dh(ref.salaries[edit.id] as number) : "—"} roles={ref.roles} depts={ref.depts} people={ref.people}
            onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); loadRef(); }} />
        : <AdminFicheModal id={edit.id} canEdit={canEdit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />)}
      {adding && (isSuper
        ? <FicheSalarie id={null} salary={null} roles={ref.roles} depts={ref.depts} people={ref.people} onClose={() => setAdding(false)}
            onDone={(newId) => {
              setAdding(false);
              if (!newId) { load(); return; }
              // Accès créé tout de suite : identifiant = nom, mot de passe notioncall123
              run(async () => {
                const r = must(await supabase.rpc("admin_create_default_access", { p_profile: newId })) as { username: string; password: string };
                const p = must(await supabase.from("profiles").select("first_name,last_name").eq("id", newId).single()) as { first_name: string; last_name: string };
                setCree({ name: `${p.first_name} ${p.last_name}`, ...r });
                await load(); await loadRef();
              }, "Fiche et accès créés");
            }} />
        : <AddAgentModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); setFGroup("agents"); load(); }} />)}
      {cree && (
        <Modal title="Fiche et accès créés" onClose={() => setCree(null)}>
          <p className="mb-3">{cree.name} peut se connecter avec :</p>
          <div className="card mb-3 grid gap-1 text-[14px]">
            <div>Identifiant : <b className="font-mono">{cree.username}</b></div>
            <div>Mot de passe : <b className="font-mono">{cree.password}</b></div>
          </div>
          <p className="mut mb-3 text-[12.5px]">Il peut garder ce mot de passe ou le changer depuis son profil.</p>
          <div className="flex justify-end"><button className="btn-pri" onClick={() => setCree(null)}>OK</button></div>
        </Modal>)}
    </Guard>
  );
}

const AGENT_ROLES: [string, string][] = [["brute", "Agent brute"], ["qualif", "Agent qualif"], ["soustraitant_d", "Soustraitant D"], ["soustraitan_s", "SousTraitan S"]];
const AGENT_VIDE = {
  first_name: "", last_name: "", role_key: "brute", phone: "", emergency_contact: "", birth_date: "", hire_date: "", validation_date: "",
  family_status: "", children_count: 0 as number | string,
  cin: "", address: "", cnss_number: "", rib: "", bank_name: "", contract_signed: false, cnss_declared: false,
};

/** Nouvel agent : seuls prénom et nom sont obligatoires. Placé dans la section Agents. */
function AddAgentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [a, setA] = useState(AGENT_VIDE);
  const [cree, setCree] = useState<{ username: string; password: string } | null>(null);
  const { busy, run } = useAction();
  const set = (k: keyof typeof AGENT_VIDE) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setA({ ...a, [k]: e.target.value });
  const ok = a.first_name.trim() !== "" && a.last_name.trim() !== "";
  if (cree)
    return (
      <Modal title="Agent ajouté" onClose={onDone}>
        <p className="mb-3">Accès au site créé. À transmettre à l&apos;agent :</p>
        <div className="card mb-3 grid gap-1 text-[14px]">
          <div>Identifiant : <b className="font-mono">{cree.username}</b></div>
          <div>Mot de passe : <b className="font-mono">{cree.password}</b></div>
        </div>
        <p className="mut mb-3 text-[12.5px]">Il peut garder ce mot de passe ou le changer depuis son profil.</p>
        <div className="flex justify-end"><button className="btn-pri" onClick={onDone}>OK</button></div>
      </Modal>
    );
  return (
    <Modal title="Ajouter un agent" onClose={onClose} wide>
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field label="Prénom *"><input className="inp" value={a.first_name} onChange={set("first_name")} /></Field>
        <Field label="Nom *"><input className="inp" value={a.last_name} onChange={set("last_name")} /></Field>
        <Field label="Rôle"><select className="inp" value={a.role_key} onChange={set("role_key")}>
          {AGENT_ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Contact"><input className="inp" placeholder="06…" value={a.phone} onChange={set("phone")} /></Field>
        <Field label="Contact urgent"><input className="inp" placeholder="06…" value={a.emergency_contact} onChange={set("emergency_contact")} /></Field>
        <Field label="Date de naissance"><input type="date" className="inp" value={a.birth_date} onChange={set("birth_date")} /></Field>
        <Field label="Date de rentrée"><input type="date" className="inp" value={a.hire_date} onChange={set("hire_date")} /></Field>
        <Field label="Date de validation"><input type="date" className="inp" value={a.validation_date} onChange={set("validation_date")} /></Field>
        <Field label="Situation familiale"><select className="inp" value={a.family_status} onChange={set("family_status")}>
          <option value="">—</option>{["Célibataire", "Marié(e)", "Divorcé(e)", "Veuf(ve)"].map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
        <Field label="Enfants à charge"><input type="number" min={0} max={20} className="inp" value={a.children_count} onChange={set("children_count")} /></Field>
        <Field label="CIN (facultatif)"><input className="inp" value={a.cin} onChange={set("cin")} /></Field>
        <Field label="Contrat"><select className="inp" value={a.contract_signed ? "oui" : "non"} onChange={(e) => setA({ ...a, contract_signed: e.target.value === "oui" })}>
          <option value="non">Pas encore</option><option value="oui">Oui</option></select></Field>
      </div>
      <Field label="Adresse (facultatif)"><input className="inp" value={a.address} onChange={set("address")} /></Field>
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field label="N° CNSS (facultatif)"><input className="inp" value={a.cnss_number} onChange={set("cnss_number")} /></Field>
        <Field label="CNSS déclarée"><select className="inp" value={a.cnss_declared ? "oui" : "non"} onChange={(e) => setA({ ...a, cnss_declared: e.target.value === "oui" })}>
          <option value="non">Non</option><option value="oui">Oui</option></select></Field>
        <Field label="RIB (facultatif)"><input className="inp" value={a.rib} onChange={set("rib")} /></Field>
      </div>
      <Field label="Banque (facultatif)"><BankSelect value={a.bank_name} onChange={(v) => setA({ ...a, bank_name: v })} /></Field>
      <p className="mut mb-3 text-[12.5px]">L&apos;agent est ajouté dans la section Agents, avec son accès au site : identifiant = son nom, mot de passe par défaut notioncall123.</p>
      <div className="flex justify-end"><button className="btn-pri" disabled={busy || !ok} onClick={() => run(async () => {
        const r = must(await supabase.rpc("admin_add_agent", { p: a })) as { username: string; password: string };
        setCree(r);
      }, "Agent ajouté")}>Ajouter l&apos;agent</button></div>
    </Modal>
  );
}

type Fiche = {
  first_name: string; last_name: string; username: string | null; role_label: string | null; status: string;
  phone: string; emergency_contact: string; birth_date: string; hire_date: string; validation_date: string;
  family_status: string; children_count: number | string; cin: string; address: string; contract_signed: boolean;
  cnss_number: string; cnss_declared: boolean; rib: string; bank_name: string;
};

/** Fiche administrative (sans salaire ni paie). Lecture seule sans le droit « modifier ». */
function AdminFicheModal({ id, canEdit, onClose, onDone }: { id: string; canEdit: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Fiche | null>(null);
  const [err, setErr] = useState("");
  const { busy, run } = useAction();
  useEffect(() => {
    supabase.rpc("admin_get_fiche", { p_profile: id }).then(({ data, error }) => {
      if (error) return setErr(error.message);
      const d = data as Record<string, unknown>;
      setF(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? (k === "children_count" ? 0 : "")])) as unknown as Fiche);
    });
  }, [id]);
  if (err) return <Modal title="Fiche" onClose={onClose}><p className="text-err">{err}</p></Modal>;
  if (!f) return <Modal title="Fiche" onClose={onClose}><Empty>Chargement…</Empty></Modal>;
  const ro = !canEdit;
  const set = (k: keyof Fiche) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const yn = (k: "contract_signed" | "cnss_declared", oui: string, non: string) => (
    <select className="inp" disabled={ro} value={f[k] ? "oui" : "non"} onChange={(e) => setF({ ...f, [k]: e.target.value === "oui" })}>
      <option value="oui">{oui}</option><option value="non">{non}</option></select>);
  return (
    <Modal title={`Fiche — ${f.first_name} ${f.last_name}`} onClose={onClose} wide>
      <p className="mut mb-3 text-[12.5px]">{f.role_label ?? "—"}{f.username ? ` · identifiant ${f.username}` : ""}{ro ? " · lecture seule" : ""}</p>
      <fieldset disabled={ro}>
        <h3 className="mb-2">Identité</h3>
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label="Prénom *"><input className="inp" value={f.first_name} onChange={set("first_name")} /></Field>
          <Field label="Nom *"><input className="inp" value={f.last_name} onChange={set("last_name")} /></Field>
          <Field label="Statut"><select className="inp" value={f.status === "actif" ? "actif" : "inactif"} onChange={set("status")}>
            <option value="actif">Actif</option><option value="inactif">Inactif</option></select></Field>
          <Field label="CIN"><input className="inp" value={f.cin} onChange={set("cin")} /></Field>
          <Field label="Date de naissance"><input type="date" className="inp" value={f.birth_date} onChange={set("birth_date")} /></Field>
          <Field label="Situation familiale"><select className="inp" value={f.family_status} onChange={set("family_status")}>
            <option value="">—</option>{["Célibataire", "Marié(e)", "Divorcé(e)", "Veuf(ve)"].map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
          <Field label="Enfants à charge"><input type="number" min={0} max={20} className="inp" value={f.children_count} onChange={set("children_count")} /></Field>
          <Field label="Contact"><input className="inp" value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Contact urgent"><input className="inp" value={f.emergency_contact} onChange={set("emergency_contact")} /></Field>
        </div>
        <Field label="Adresse"><input className="inp" value={f.address} onChange={set("address")} /></Field>
        <h3 className="mb-2 mt-2">Contrat</h3>
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label="Date de rentrée"><input type="date" className="inp" value={f.hire_date} onChange={set("hire_date")} /></Field>
          <Field label="Date de validation"><input type="date" className="inp" value={f.validation_date} onChange={set("validation_date")} /></Field>
          <Field label="Contrat">{yn("contract_signed", "Oui", "Pas encore")}</Field>
        </div>
        <h3 className="mb-2 mt-2">CNSS & banque</h3>
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label="N° CNSS"><input className="inp" value={f.cnss_number} onChange={set("cnss_number")} /></Field>
          <Field label="CNSS déclarée">{yn("cnss_declared", "Oui", "Non")}</Field>
          <Field label="RIB"><input className="inp" value={f.rib} onChange={set("rib")} /></Field>
        </div>
        <Field label="Banque">{ro ? <input className="inp" value={f.bank_name || "—"} readOnly /> : <BankSelect value={f.bank_name} onChange={(v) => setF({ ...f, bank_name: v })} />}</Field>
      </fieldset>
      <div className="mt-2 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>{ro ? "Fermer" : "Annuler"}</button>
        {canEdit && <button className="btn-pri" disabled={busy || !f.first_name.trim() || !f.last_name.trim()} onClick={() => run(async () => {
          must(await supabase.rpc("admin_update_fiche", { p_profile: id, p: f }));
          onDone();
        }, "Fiche enregistrée")}>Enregistrer</button>}
      </div>
    </Modal>
  );
}
