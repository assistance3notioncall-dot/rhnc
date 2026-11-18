"use client";
// Fiche salarié complète (identité, contrat, rémunération, CNSS & paie).
// Partagée par Salariés et par Suivi Administratif (super admin).
import { useCallback, useEffect, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { BankSelect } from "@/components/BankSelect";
import { Field, Modal, useAction } from "@/components/ui";
import { dfr, fullName } from "@/lib/format";

export type Row = { id: string; matricule: string | null; first_name: string; last_name: string; username: string | null; email: string | null; role_key: string | null; role_label: string | null; section: string | null; hire_date: string | null; status: string; account_status: string };
export type Role = { key: string; label: string; kind: string; locked: boolean; color: string };
export type Dept = { id: string; name: string };
const GROUPS: [string, string][] = [["direction", "Direction"], ["back_office", "Back office"], ["agents", "Agents"], ["extra", "Entretien & logistique"]];

const EMPTY = {
  matricule: "", username: "", first_name: "", last_name: "", role_key: "brute", department_id: "", manager_id: "", job_title: "", hire_date: "",
  contract_type: "CDI", contract_end: "", trial_end: "", exit_date: "", groupe: "", hors_effectif: false as boolean, cin: "", phone: "", email: "", birth_date: "", family_status: "", children_count: 0, address: "", emergency_contact: "", status: "actif", contract_signed: false as boolean,
};
const COMP = {
  base_salary: 0, transport_allowance: 0, meal_allowance: 0, attendance_bonus: 0, cnss_number: "", rib: "", bank_name: "",
  cnss_mode: "plafonne", cnss_base: 6000 as number | string, ir_applies: false, in_payroll: true, pay_method: "",
  pay_plan: "", cnf_codes: "" as string | string[], rdv_prime: true, rdv_prime_paid: false, cnss_employee_fixed: "" as number | string,
};
const COMP_COLS = "transport_allowance,meal_allowance,attendance_bonus,cnss_number,rib,bank_name,cnss_mode,cnss_base,ir_applies,in_payroll,pay_method,pay_plan,cnf_codes,rdv_prime,rdv_prime_paid,cnss_employee_fixed";
// Responsables possibles selon le groupe : agents → Monim (abdel) ou Kawtar ; back office / entretien → Amal ; direction → Monim ou Amal
const RESP_BY_GROUP: Record<string, string[]> = { agents: ["abdel", "kawtar"], back_office: ["amal"], extra: ["amal"], direction: ["abdel", "amal"] };
const CNSS_MODES: [string, string][] = [
  ["non_declare", "Non déclaré"], ["tahfiz", "Tahfiz (exonéré)"], ["plafonne", "Plafonné (base CNSS fixe)"], ["offert", "Offert (payé par l'employeur)"],
];

export function FicheModal({ id, salary, roles, depts, people, onClose, onDone }: { id: string | null; salary: string | null; roles: Role[]; depts: Dept[]; people: Row[]; onClose: () => void; onDone: (createdId?: string) => void }) {
  const { me, isSuper } = useSession();
  const [f, setF] = useState<typeof EMPTY>(EMPTY);
  const [c, setC] = useState<typeof COMP>(COMP);
  const { busy, run } = useAction();
  useEffect(() => {
    if (!id) return;
    supabase.from("profiles").select("*").eq("id", id).single().then(({ data }) => data && setF(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, data[k] ?? (k === "children_count" ? 0 : k === "hors_effectif" || k === "contract_signed" ? false : "")])) as typeof EMPTY));
    // base_salary n'est pas lisible directement (salaire masquable) : affiché via `salary`
    supabase.from("employee_compensation").select(COMP_COLS).eq("profile_id", id).maybeSingle().then(({ data }) => data && setC(Object.fromEntries(Object.keys(COMP).map((k) => [k, (data as Record<string, unknown>)[k] ?? (k in COMP && typeof COMP[k as keyof typeof COMP] === "boolean" ? COMP[k as keyof typeof COMP] : "")])) as typeof COMP));
  }, [id]);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const setc = (k: keyof typeof COMP) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setC({ ...c, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const nn = (v: unknown) => (v === "" ? null : v);
  const isAgentFiche = f.groupe === "agents" || (!f.groupe && (["brute", "qualif"].includes(f.role_key) || f.role_key.startsWith("soustrait")));
  const ficheGroup = f.groupe || (isAgentFiche ? "agents" : "");
  const allowedResp = RESP_BY_GROUP[ficheGroup];
  const sensitive = (k: string) => { const r = roles.find((x) => x.key === k); return !!r && (r.locked || r.kind === "rh" || r.kind === "admin"); };

  async function save() {
    await run(async () => {
      const row: Record<string, unknown> = {
        ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, nn(v)])),
        username: f.username.trim().toLowerCase(), children_count: Number(f.children_count) || 0, company_id: me!.company_id,
      };
      // Date de sortie passée → statut « sorti » (fiche en historique, paie au prorata du mois de sortie)
      if (f.exit_date && f.exit_date <= new Date().toISOString().slice(0, 10)) row.status = "sorti";
      if (!f.exit_date && f.status === "sorti") throw new Error("Indiquez la date de sortie.");
      const comp = { transport_allowance: Number(c.transport_allowance) || 0, meal_allowance: Number(c.meal_allowance) || 0, attendance_bonus: Number(c.attendance_bonus) || 0, cnss_number: nn(c.cnss_number), rib: nn(c.rib), bank_name: nn(String(c.bank_name ?? "").trim()),
        cnss_mode: c.cnss_mode || "plafonne", cnss_base: c.cnss_base === "" ? null : Number(c.cnss_base), ir_applies: !!c.ir_applies, in_payroll: !!c.in_payroll, pay_method: nn(c.pay_method),
        pay_plan: nn(c.pay_plan), rdv_prime: !!c.rdv_prime, rdv_prime_paid: !!c.rdv_prime_paid, cnss_employee_fixed: c.cnss_employee_fixed === "" || c.cnss_employee_fixed == null ? null : Number(c.cnss_employee_fixed), cnf_codes: (Array.isArray(c.cnf_codes) ? c.cnf_codes : String(c.cnf_codes).split(/[\s,;]+/)).map((x) => x.trim().toUpperCase()).filter(Boolean) };
      if (id) {
        if (!row.email) delete row.email; // ne jamais vider l'e-mail de connexion
        must(await supabase.from("profiles").update(row).eq("id", id));
        must(await supabase.from("employee_compensation").upsert({ profile_id: id, ...comp }));
      } else {
        const created = must(await supabase.from("profiles").insert(row).select("id").single()) as { id: string };
        must(await supabase.from("employee_compensation").upsert({ profile_id: created.id, base_salary: Number(c.base_salary) || 0, ...comp }));
        return onDone(created.id);
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
        <Field label="Section (groupe)"><select className="inp" value={f.groupe} onChange={set("groupe")}>
          <option value="">Auto (selon le rôle)</option>{GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Responsable"><select className="inp" value={f.manager_id} onChange={set("manager_id")}>
          <option value="">—</option>{people.filter((p) => p.id !== id && p.status === "actif"
            // Agents : responsable = Monim (sup) ou Kawtar (chef d'équipe, primes d'équipe sur ses agents)
            && (!allowedResp || allowedResp.includes(p.username ?? "") || p.id === f.manager_id))
            .map((p) => <option key={p.id} value={p.id}>{fullName(p)}{p.username === "abdel" ? " (Monim)" : ""}</option>)}</select></Field>
        <Field label="Poste"><input className="inp" value={f.job_title} placeholder="intitulé réel du poste" onChange={set("job_title")} /></Field>
        <Field label="Statut"><select className="inp" value={f.status} onChange={set("status")}><option value="actif">Actif</option><option value="suspendu">Suspendu</option><option value="sorti">Sorti</option></select></Field>
        {isSuper && <label className="mb-3 flex items-center gap-2 self-end text-[13px]" title="Compte d'accès uniquement (direction, admin, RH) : retiré de la liste des salariés et de la paie">
          <input type="checkbox" checked={!!f.hors_effectif} onChange={set("hors_effectif")} /> Hors effectif (pas de fiche salarié ni de paie)</label>}
      </div>
      <h3 className="mb-2 mt-2">Contrat</h3>
      <div className="grid gap-x-3 sm:grid-cols-4">
        <Field label="Type"><select className="inp" value={f.contract_type} onChange={set("contract_type")}>{["CDI", "CDD", "ANAPEC", "stage", "interim"].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Embauche"><input type="date" className="inp" value={f.hire_date} onChange={set("hire_date")} /></Field>
        <Field label="Fin d'essai"><input type="date" className="inp" value={f.trial_end} onChange={set("trial_end")} /></Field>
        <Field label="Fin de contrat"><input type="date" className="inp" value={f.contract_end} onChange={set("contract_end")} /></Field>
        <Field label="Date de sortie"><input type="date" className="inp" value={f.exit_date} onChange={set("exit_date")} /></Field>
        <Field label="Contrat signé"><select className="inp" value={f.contract_signed ? "oui" : "non"} onChange={(e) => setF({ ...f, contract_signed: e.target.value === "oui" })}><option value="oui">Oui</option><option value="non">Pas encore</option></select></Field>
      </div>
      {f.exit_date && <p className="-mt-1 mb-2 text-[12.5px] text-warn">Sortie le {dfr(f.exit_date)} : payé(e) au prorata des jours ouvrables jusqu&apos;à cette date, puis retiré(e) de la liste active (historique).</p>}
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
      {id && <AgentCodes profileId={id} />}
      <h3 className="mb-2 mt-2">Rémunération</h3>
      <div className="grid gap-x-3 sm:grid-cols-3">
        {id ? <Field label="Salaire de base (via « Salaire »)"><input className="inp" disabled value={salary ?? "—"} /></Field>
          : <Field label="Salaire de base (DH brut)"><input type="number" className="inp" value={c.base_salary} onChange={setc("base_salary")} /></Field>}
        <Field label="Prime d'assiduité (DH)"><input type="number" className="inp" value={c.attendance_bonus} onChange={setc("attendance_bonus")} /></Field>
        <Field label="Indemnité transport"><input type="number" className="inp" value={c.transport_allowance} onChange={setc("transport_allowance")} /></Field>
        <Field label="Indemnité panier"><input type="number" className="inp" value={c.meal_allowance} onChange={setc("meal_allowance")} /></Field>
        <Field label="N° CNSS"><input className="inp" value={c.cnss_number} onChange={setc("cnss_number")} /></Field>
        <Field label="RIB"><input className="inp" value={c.rib} onChange={setc("rib")} /></Field>
        <Field label="Banque"><BankSelect value={String(c.bank_name ?? "")} onChange={(v) => setC({ ...c, bank_name: v })} /></Field>
      </div>
      <h3 className="mb-2 mt-2">CNSS & paiement</h3>
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field label="Mode CNSS"><select className="inp" value={c.cnss_mode} onChange={setc("cnss_mode")}>
          {CNSS_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          {c.cnss_mode === "declare" && <option value="declare">Déclaré (salaire réel)</option>}</select></Field>
        {["plafonne", "offert"].includes(c.cnss_mode)
          ? <Field label="Base CNSS déclarée (DH)"><input type="number" className="inp" value={c.cnss_base} onChange={setc("cnss_base")} /></Field>
          : <div />}
        {["plafonne", "declare"].includes(c.cnss_mode) && <Field label="Part salariale fixe (DH, vide = 6,4 %)"><input type="number" className="inp" value={c.cnss_employee_fixed ?? ""} onChange={setc("cnss_employee_fixed")} /></Field>}
        <Field label="Reste à prendre payé par"><select className="inp" value={c.pay_method} onChange={setc("pay_method")}>
          <option value="">Auto (virement si RIB valide, sinon espèces)</option><option value="virement">Virement</option><option value="especes">Espèces</option></select></Field>
        <Field label="Plan de rémunération"><select className="inp" value={c.pay_plan} onChange={setc("pay_plan")}>
          <option value="">Standard (salaire de base + 150 DH / RDV OK)</option>
          <option value="confirme">Confirmé : base 5 000 + prime qualité + 150 DH / déballe</option>
          <option value="sup_qualif">Chef d&apos;équipe qualif : base 5 000 + primes équipe qualif + 150 DH / RDV OK</option></select></Field>
        {c.pay_plan === "confirme" ? <Field label="Code(s) confirmateur dans les stats"><input className="inp" placeholder="ex. AS"
          value={Array.isArray(c.cnf_codes) ? c.cnf_codes.join(", ") : c.cnf_codes} onChange={setc("cnf_codes")} /></Field> : <div />}
        <div />
        <label className="mb-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!c.ir_applies} onChange={setc("ir_applies")} /> Retenir l&apos;IR</label>
        <label className="mb-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!c.rdv_prime} onChange={setc("rdv_prime")} /> Payer 150 DH par RDV OK pris</label>
        {c.rdv_prime && <label className="mb-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!c.rdv_prime_paid} onChange={setc("rdv_prime_paid")} /> … versés à part comme challenge (hors brut)</label>}
        <label className="mb-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!c.in_payroll} onChange={setc("in_payroll")} /> Inclus dans la paie</label>
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn-pri" disabled={busy || !f.first_name || !/^[a-z0-9.]+$/.test(f.username.trim().toLowerCase())} onClick={save}>Enregistrer</button>
      </div>
    </Modal>
  );
}

/** Tags stats : codes agent (planning / APPT) rattachés au salarié, avec leur catégorie (brute, qualif, sous-traitant). */
function AgentCodes({ profileId }: { profileId: string }) {
  type Ag = { code: string; display_name: string; profile_id: string | null };
  const [all, setAll] = useState<Ag[]>([]);
  const [cfg, setCfg] = useState<{ qualif: string[]; sous_traitants: string[] }>({ qualif: [], sous_traitants: [] });
  const [code, setCode] = useState("");
  const [cat, setCat] = useState("brute");
  const { busy, run } = useAction();
  const load = useCallback(async () => {
    const [{ data: a }, { data: c }] = await Promise.all([
      supabase.from("rdv_agents").select("code,display_name,profile_id").order("code"),
      supabase.from("rdv_config").select("qualif,sous_traitants").maybeSingle(),
    ]);
    setAll((a as Ag[]) ?? []);
    if (c) setCfg(c as { qualif: string[]; sous_traitants: string[] });
  }, []);
  useEffect(() => { load(); }, [load]);
  const mine = all.filter((a) => a.profile_id === profileId);
  const free = all.filter((a) => !a.profile_id);
  const catOf = (k: string) => (cfg.qualif.includes(k) ? "qualif" : cfg.sous_traitants.includes(k) ? "soustraitant" : "brute");
  const LABEL: Record<string, string> = { brute: "Brute", qualif: "Qualif", soustraitant: "Sous-traitant" };
  const TONE: Record<string, string> = { brute: "bg-pri-l text-pri-d", qualif: "bg-[#ede9fe] text-[#6d28d9]", soustraitant: "bg-warn-l text-warn" };
  const save = (k: string, category: string, link: boolean) => run(async () => {
    must(await supabase.rpc("set_agent_code", { p_profile: profileId, p_code: k, p_category: category, p_link: link }));
    setCode(""); await load();
  }, link ? `Code « ${k} » enregistré` : `Code « ${k} » détaché`);
  return (<>
    <h3 className="mb-1 mt-2">Tags stats (codes agent)</h3>
    <p className="mut mb-2 text-[12.5px]">Codes utilisés dans le planning et les stats RDV pour ce salarié. Qualif : 1 RDV compte pour 1/2 en paie.</p>
    <div className="mb-2 flex flex-wrap gap-2">
      {mine.length === 0 && <span className="mut text-[13px]">Aucun code rattaché.</span>}
      {mine.map((a) => {
        const k = catOf(a.code);
        return (
          <span key={a.code} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium ${TONE[k]}`}>
            <b className="font-mono">{a.code}</b>
            <select className="rounded bg-transparent text-[12px]" value={k} disabled={busy} onChange={(e) => save(a.code, e.target.value, true)} title="Changer la catégorie">
              {Object.entries(LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button className="opacity-60 hover:opacity-100" disabled={busy} title="Détacher ce code"
              onClick={() => confirm(`Détacher le code « ${a.code} » de ce salarié ?`) && save(a.code, k, false)}>✕</button>
          </span>);
      })}
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input className="inp w-40" list="free-codes" placeholder="code (ex. hd)" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} />
      <datalist id="free-codes">{free.map((a) => <option key={a.code} value={a.code}>{a.display_name}</option>)}</datalist>
      <select className="inp w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
        {Object.entries(LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <button className="btn btn-sm" disabled={busy || !code.trim()} onClick={() => save(code.trim(), cat, true)}>+ Ajouter le tag</button>
    </div>
  </>);
}
