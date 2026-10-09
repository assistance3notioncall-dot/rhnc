"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { PageHead, Tabs, useAction } from "@/components/ui";
import { dfr } from "@/lib/format";

type LT = { id: string; code: string; label: string; unit: string; default_days: number | null; monthly_accrual: number; deducts_balance: boolean; requires_attachment: boolean; paid: boolean; active: boolean; color: string };
type Hol = { id: string; day: string; label: string; is_religious: boolean; confirmed: boolean };
type Dept = { id: string; name: string };
type Company = { id: string; name: string; legal_form: string | null; ice: string | null; rc: string | null; cnss_employer_no: string | null; address: string | null; city: string | null };
type RdvCfg = { qualif: string[]; sous_traitants: string[]; nc_codes: string[]; challenge: unknown };

export default function Parametres() {
  const { me, can } = useSession();
  const canEdit = can("parametres", true);
  const [tab, setTab] = useState("societe");
  const [co, setCo] = useState<Company | null>(null);
  const [lts, setLts] = useState<LT[]>([]);
  const [hols, setHols] = useState<Hol[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [rdv, setRdv] = useState<RdvCfg | null>(null);
  const [pay, setPay] = useState<{ valid_from: string; params: unknown } | null>(null);
  const [newHol, setNewHol] = useState({ day: "", label: "", is_religious: false });
  const [newDept, setNewDept] = useState("");
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    const [c, l, h, d, r, p] = await Promise.all([
      supabase.from("companies").select("*").maybeSingle(),
      supabase.from("leave_types").select("*").order("sort"),
      supabase.from("holidays").select("*").gte("day", `${new Date().getFullYear()}-01-01`).order("day"),
      supabase.from("departments").select("id,name").order("name"),
      supabase.from("rdv_config").select("*").maybeSingle(),
      supabase.from("payroll_settings").select("valid_from,params").order("valid_from", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setCo(c.data as Company); setLts((l.data as LT[]) ?? []); setHols((h.data as Hol[]) ?? []); setDepts((d.data as Dept[]) ?? []);
    setRdv(r.data as RdvCfg); setPay(p.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveLt = (lt: LT, patch: Partial<LT>) => run(async () => { must(await supabase.from("leave_types").update(patch).eq("id", lt.id)); await load(); }, "Enregistré");

  return (
    <Guard module="parametres">
      <PageHead title="Paramètres" sub={canEdit ? "Société, congés, jours fériés, sections, RDV et paie." : "Consultation seule."} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "societe", label: "Société" }, { key: "conges", label: "Types de congé" }, { key: "feries", label: "Jours fériés" },
        { key: "sections", label: "Sections" }, { key: "rdv", label: "RDV & challenge" }, { key: "paie", label: "Barèmes paie" },
      ]} />

      {tab === "societe" && co && (
        <div className="card grid gap-x-3 sm:grid-cols-2">
          {(["name", "legal_form", "ice", "rc", "cnss_employer_no", "city", "address"] as const).map((k) => (
            <label key={k} className="mb-3.5 block"><span className="lbl">{{ name: "Raison sociale", legal_form: "Forme juridique", ice: "ICE", rc: "RC", cnss_employer_no: "N° CNSS employeur", city: "Ville", address: "Adresse" }[k]}</span>
              <input className="inp" disabled={me?.role !== "admin"} value={co[k] ?? ""} onChange={(e) => setCo({ ...co, [k]: e.target.value })} /></label>
          ))}
          {me?.role === "admin" && <div className="sm:col-span-2"><button className="btn-pri" disabled={busy} onClick={() => run(async () => {
            const { id, ...rest } = co; must(await supabase.from("companies").update(rest).eq("id", id));
          }, "Société mise à jour")}>Enregistrer</button></div>}
        </div>
      )}

      {tab === "conges" && (
        <div className="card overflow-x-auto p-0"><table className="tbl">
          <thead><tr><th>Type</th><th>Unité</th><th className="text-right">Jours</th><th className="text-right">Acquis / mois</th><th>Décompte solde</th><th>Justificatif</th><th>Payé</th><th>Actif</th></tr></thead>
          <tbody>{lts.map((l) => (
            <tr key={l.id}>
              <td><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />{l.label}</td>
              <td>{l.unit}</td>
              <td className="text-right"><input type="number" className="inp w-20 py-1 text-right" disabled={!canEdit} defaultValue={l.default_days ?? ""} onBlur={(e) => e.target.value !== String(l.default_days ?? "") && saveLt(l, { default_days: e.target.value ? Number(e.target.value) : null })} /></td>
              <td className="text-right"><input type="number" step="0.5" className="inp w-20 py-1 text-right" disabled={!canEdit} defaultValue={l.monthly_accrual} onBlur={(e) => Number(e.target.value) !== Number(l.monthly_accrual) && saveLt(l, { monthly_accrual: Number(e.target.value) })} /></td>
              {(["deducts_balance", "requires_attachment", "paid", "active"] as const).map((k) => (
                <td key={k}><input type="checkbox" disabled={!canEdit || busy} checked={l[k]} onChange={() => saveLt(l, { [k]: !l[k] })} /></td>
              ))}
            </tr>))}</tbody>
        </table></div>
      )}

      {tab === "feries" && (
        <div className="card">
          {canEdit && <div className="mb-4 flex flex-wrap gap-2">
            <input type="date" className="inp w-auto" value={newHol.day} onChange={(e) => setNewHol({ ...newHol, day: e.target.value })} />
            <input className="inp max-w-xs" placeholder="Libellé" value={newHol.label} onChange={(e) => setNewHol({ ...newHol, label: e.target.value })} />
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={newHol.is_religious} onChange={(e) => setNewHol({ ...newHol, is_religious: e.target.checked })} /> Religieux (à confirmer)</label>
            <button className="btn-pri" disabled={busy || !newHol.day || !newHol.label} onClick={() => run(async () => {
              must(await supabase.from("holidays").insert({ company_id: me!.company_id, ...newHol, confirmed: !newHol.is_religious })); setNewHol({ day: "", label: "", is_religious: false }); await load();
            }, "Jour férié ajouté")}>Ajouter</button>
          </div>}
          <table className="tbl"><tbody>{hols.map((h) => (
            <tr key={h.id}><td className="w-32">{dfr(h.day)}</td><td className="font-medium">{h.label}</td>
              <td>{h.is_religious && (h.confirmed ? <span className="badge bg-ok-l text-ok">confirmé</span> : <span className="badge bg-warn-l text-warn">à confirmer</span>)}</td>
              <td className="whitespace-nowrap text-right">{canEdit && <>
                {h.is_religious && !h.confirmed && <button className="btn btn-sm" onClick={() => run(async () => { must(await supabase.from("holidays").update({ confirmed: true }).eq("id", h.id)); await load(); }, "Confirmé")}>Confirmer</button>}
                <button className="btn-no btn-sm ml-1" onClick={() => run(async () => { must(await supabase.from("holidays").delete().eq("id", h.id)); await load(); }, "Supprimé")}>✕</button>
              </>}</td></tr>))}</tbody></table>
        </div>
      )}

      {tab === "sections" && (
        <div className="card max-w-xl">
          {canEdit && <div className="mb-4 flex gap-2"><input className="inp" placeholder="Nouvelle section" value={newDept} onChange={(e) => setNewDept(e.target.value)} />
            <button className="btn-pri" disabled={busy || !newDept.trim()} onClick={() => run(async () => { must(await supabase.from("departments").insert({ company_id: me!.company_id, name: newDept.trim() })); setNewDept(""); await load(); }, "Section ajoutée")}>Ajouter</button></div>}
          {depts.map((d) => <div key={d.id} className="border-b border-line py-2 last:border-0">{d.name}</div>)}
        </div>
      )}

      {tab === "rdv" && rdv && (
        <div className="card">
          {(["qualif", "sous_traitants", "nc_codes"] as const).map((k) => (
            <label key={k} className="mb-3.5 block"><span className="lbl">{{ qualif: "Agents qualif (codes, séparés par des virgules)", sous_traitants: "Sous-traitants", nc_codes: "Codes Cnf « sous-traitant » (NC)" }[k]}</span>
              <input className="inp" disabled={!canEdit} value={rdv[k].join(", ")} onChange={(e) => setRdv({ ...rdv, [k]: e.target.value.split(",").map((x) => x.trim().toLowerCase()) })} /></label>
          ))}
          <label className="mb-3.5 block"><span className="lbl">Barème challenge (JSON)</span>
            <textarea className="inp font-mono text-[12.5px]" rows={10} disabled={!canEdit} defaultValue={JSON.stringify(rdv.challenge, null, 2)} id="challenge-json" /></label>
          {canEdit && <button className="btn-pri" disabled={busy} onClick={() => run(async () => {
            const challenge = JSON.parse((document.getElementById("challenge-json") as HTMLTextAreaElement).value);
            must(await supabase.from("rdv_config").update({ qualif: rdv.qualif, sous_traitants: rdv.sous_traitants, nc_codes: rdv.nc_codes.map((x) => (x === "nc" ? "NC" : x)), challenge, updated_at: new Date().toISOString() }).eq("company_id", me!.company_id));
          }, "Configuration RDV enregistrée")}>Enregistrer</button>}
        </div>
      )}

      {tab === "paie" && (
        <div className="card">
          <p className="mut mb-2">Barème en vigueur depuis le {dfr(pay?.valid_from)} — à faire valider par votre expert-comptable. Pour changer un taux, ajoutez une nouvelle version datée (SQL Editor) afin de garder l&apos;historique.</p>
          <pre className="max-h-[480px] overflow-auto rounded-lg bg-gray2-l p-3 text-[12.5px]">{JSON.stringify(pay?.params ?? {}, null, 2)}</pre>
        </div>
      )}
    </Guard>
  );
}
