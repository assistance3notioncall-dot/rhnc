"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { Empty, Field, Modal, useAction } from "@/components/ui";
import { dh, fullName, monthLabel, num } from "@/lib/format";

type Person = { id: string; first_name: string; last_name: string };
type Adv = { id: string; ref: string; profile_id: string; full_name: string; amount: number; status: string; comment: string | null;
  category: string | null; created_at: string; taken_at: string | null; created_by_name: string | null; rejection_reason: string | null };
const ADV_STATUS: Record<string, [string, string]> = {
  envoyee: ["À confirmer", "bg-warn-l text-warn"], valid_mgr: ["À confirmer", "bg-warn-l text-warn"],
  valid_rh: ["Confirmée · à remettre", "bg-pri-l text-pri-d"], traitee: ["Prise", "bg-ok-l text-ok"], refusee: ["Refusée", "bg-err-l text-err"],
};
export function AdvancesPanel({ month, people, isSuper, canAdd, onChanged }: { month: string; people: Person[]; isSuper: boolean; canAdd: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<Adv[]>([]);
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState(""); const [amount, setAmount] = useState(""); const [note, setNote] = useState("");
  const { busy, run } = useAction();
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_advances", { p_month: month });
    if (!error) setRows((data as Adv[]) ?? []);
  }, [month]);
  useEffect(() => { load(); }, [load]);
  const act = (fn: string, args: Record<string, unknown>, msg: string) => run(async () => { must(await supabase.rpc(fn, args)); await load(); onChanged(); }, msg);
  const total = (st: string) => rows.filter((r) => r.status === st).reduce((a, r) => a + Number(r.amount), 0);
  return (<>
    <div className="flex flex-wrap items-center gap-2 p-3">
      <span className="mut text-[12.5px]">À confirmer : <b>{dh(total("valid_mgr") + total("envoyee"))}</b> · Confirmées à remettre : <b>{dh(total("valid_rh"))}</b> · Prises ce mois : <b>{dh(total("traitee"))}</b></span>
      {canAdd && <button className="btn-pri btn-sm ml-auto" onClick={() => setAdding(true)}>+ Nouvelle avance</button>}
    </div>
    {rows.length === 0 ? <Empty>Aucune avance pour {monthLabel(month)}.</Empty> : (
      <table className="tbl">
        <thead><tr><th>Réf.</th><th>Salarié</th><th className="text-right">Montant</th><th>Statut</th><th>Saisie</th><th>Prise le</th><th /></tr></thead>
        <tbody>{rows.map((r) => { const [lbl, cls] = ADV_STATUS[r.status] ?? [r.status, ""]; return (
          <tr key={r.id}>
            <td className="font-medium">{r.ref}</td>
            <td>{r.full_name}{r.comment && <div className="mut text-[11.5px]">« {r.comment} »</div>}</td>
            <td className="text-right font-semibold">{num(r.amount, 2)}</td>
            <td><span className={`badge ${cls}`}>{lbl}</span>{r.rejection_reason && <div className="mut text-[11.5px]">{r.rejection_reason}</div>}</td>
            <td className="mut text-[12px]">{new Date(r.created_at).toLocaleDateString("fr-FR")}{r.category === "saisie_rh" ? ` · par ${r.created_by_name ?? "RH"}` : " · demande du salarié"}</td>
            <td className="mut">{r.taken_at ? new Date(r.taken_at).toLocaleDateString("fr-FR") : "—"}</td>
            <td className="whitespace-nowrap text-right">
              {["envoyee", "valid_mgr"].includes(r.status) && (isSuper ? <>
                <button className="btn-ok btn-sm" disabled={busy} onClick={() => act("decide_request", { p_id: r.id, p_approve: true, p_comment: null }, "Avance confirmée")}>Confirmer</button>
                <button className="btn-no btn-sm ml-1" disabled={busy} onClick={() => { const m = prompt("Motif du refus ?"); if (m !== null) act("decide_request", { p_id: r.id, p_approve: false, p_comment: m || "Refusée" }, "Avance refusée"); }}>Refuser</button>
              </> : <span className="mut text-[12px]">en attente de l&apos;administration</span>)}
              {r.status === "valid_rh" && <button className="btn btn-sm" disabled={busy} title="Le salarié a reçu l'argent : l'avance est retenue sur la paie de ce mois"
                onClick={() => confirm(`${r.full_name} a bien reçu ${dh(r.amount)} ?`) && act("complete_request", { p_id: r.id, p_comment: null }, "Avance marquée prise")}>Marquer prise</button>}
            </td>
          </tr>); })}</tbody>
      </table>)}
    {adding && (
      <Modal title="Nouvelle avance" onClose={() => setAdding(false)}>
        <p className="mut mb-3 text-[12.5px]">Avance demandée de vive voix : elle sera confirmée par l&apos;administration, puis retenue sur la paie quand elle est marquée « Prise ».</p>
        <Field label="Salarié"><select className="inp" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">— choisir —</option>{[...people].sort((a, b) => fullName(a).localeCompare(fullName(b))).map((p) => <option key={p.id} value={p.id}>{fullName(p)}</option>)}</select></Field>
        <Field label="Montant (DH)"><input type="number" className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Commentaire (facultatif)"><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn" onClick={() => setAdding(false)}>Annuler</button>
          <button className="btn-pri" disabled={busy || !who || !(Number(amount) > 0)} onClick={() => run(async () => {
            must(await supabase.rpc("create_advance_for", { p_profile: who, p_amount: Number(amount), p_comment: note || null }));
            setAdding(false); setWho(""); setAmount(""); setNote(""); await load(); onChanged();
          }, "Avance enregistrée : à confirmer par l'administration")}>Enregistrer</button>
        </div>
      </Modal>)}
  </>);
}
