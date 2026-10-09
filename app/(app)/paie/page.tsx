"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Badge, Empty, Field, Kpi, Modal, PageHead, Tabs, useAction } from "@/components/ui";
import { PayslipView, type Slip } from "@/components/Payslip";
import { dh, downloadCSV, fullName, monthLabel, monthStart, num } from "@/lib/format";
import { printHtml } from "@/lib/print";

type Period = { id: string; month: string; status: string; computed_at: string | null; validated_at: string | null };
type Person = { id: string; first_name: string; last_name: string; matricule: string | null };
type Input = { id: number; profile_id: string; code: string; label: string; kind: string; quantity: number | null; amount: number | null; cotisable: boolean; imposable: boolean };

const PRESETS: Record<string, { label: string; kind: string; qty?: boolean; cotisable?: boolean; imposable?: boolean }> = {
  HS25: { label: "Heures sup. +25 %", kind: "gain", qty: true },
  HS50: { label: "Heures sup. +50 %", kind: "gain", qty: true },
  HS100: { label: "Heures sup. +100 %", kind: "gain", qty: true },
  ABS_NP: { label: "Absence non payée (jours)", kind: "gain", qty: true },
  PRIME: { label: "Prime exceptionnelle", kind: "gain" },
  AVANCE: { label: "Remboursement avance", kind: "retenue", cotisable: false, imposable: false },
  RETENUE: { label: "Retenue diverse", kind: "retenue", cotisable: false, imposable: false },
};

export default function Paie() {
  const { me, can } = useSession();
  const canEdit = can("paie", true);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [cur, setCur] = useState<Period | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [inputs, setInputs] = useState<Input[]>([]);
  const [tab, setTab] = useState("bulletins");
  const [view, setView] = useState<Slip | null>(null);
  const [addInput, setAddInput] = useState(false);
  const [newMonth, setNewMonth] = useState(monthStart().slice(0, 7));
  const { busy, run } = useAction();

  const loadPeriods = useCallback(async () => {
    const { data } = await supabase.from("payroll_periods").select("*").order("month", { ascending: false });
    const list = (data as Period[]) ?? [];
    setPeriods(list);
    setCur((c) => list.find((p) => p.id === c?.id) ?? list[0] ?? null);
  }, []);
  const loadPeriod = useCallback(async () => {
    if (!cur) { setSlips([]); setInputs([]); return; }
    const [{ data: s }, { data: i }] = await Promise.all([
      supabase.from("payslips").select("*").eq("period_id", cur.id),
      supabase.from("payroll_inputs").select("*").eq("period_id", cur.id).order("id"),
    ]);
    setSlips((s as Slip[]) ?? []); setInputs((i as Input[]) ?? []);
  }, [cur]);
  useEffect(() => { loadPeriods(); supabase.from("profiles").select("id,first_name,last_name,matricule").order("first_name").then(({ data }) => setPeople((data as Person[]) ?? [])); }, [loadPeriods]);
  useEffect(() => { loadPeriod(); }, [loadPeriod]);

  const name = (id: string) => fullName(people.find((p) => p.id === id));
  const open = cur && ["ouverte", "calculee"].includes(cur.status);
  const sum = (k: keyof Slip) => slips.reduce((a, s) => a + Number(s[k] ?? 0), 0);

  return (
    <Guard module="paie">
      <PageHead title="Paie" sub="Barèmes Maroc 2026 (CNSS, AMO, IR, frais pro) — à faire valider par votre comptable.">
        <select className="inp w-auto" value={cur?.id ?? ""} onChange={(e) => setCur(periods.find((p) => p.id === e.target.value) ?? null)}>
          {periods.length === 0 && <option value="">Aucune période</option>}
          {periods.map((p) => <option key={p.id} value={p.id}>{monthLabel(p.month)}</option>)}
        </select>
        {canEdit && (<>
          <input type="month" className="inp w-auto" value={newMonth} onChange={(e) => setNewMonth(e.target.value)} />
          <button className="btn" disabled={busy} onClick={() => run(async () => {
            must(await supabase.from("payroll_periods").insert({ company_id: me!.company_id, month: newMonth + "-01" })); await loadPeriods();
          }, "Période ouverte")}>Ouvrir le mois</button>
        </>)}
      </PageHead>
      {!cur ? <div className="card"><Empty>Ouvrez un mois de paie pour commencer.</Empty></div> : (<>
        <div className="card mb-4 flex flex-wrap items-center gap-3">
          <h2 className="capitalize">{monthLabel(cur.month)}</h2><Badge status={cur.status} />
          <div className="ml-auto flex flex-wrap gap-2">
            {canEdit && open && <button className="btn-pri" disabled={busy} onClick={() => run(async () => {
              const n = must(await supabase.rpc("compute_payroll", { p_period: cur.id })); await loadPeriods(); await loadPeriod(); return n;
            }, "Paie calculée (absences, retards, challenge et HS inclus)")}>{cur.status === "calculee" ? "Recalculer" : "Calculer la paie"}</button>}
            {canEdit && cur.status === "calculee" && <button className="btn-ok" disabled={busy} onClick={() => confirm("Valider ? Les bulletins seront publiés aux salariés et le mois sera verrouillé.") && run(async () => {
              must(await supabase.rpc("validate_payroll", { p_period: cur.id })); await loadPeriods();
            }, "Paie validée — bulletins publiés")}>Valider & publier</button>}
            <button className="btn" disabled={!slips.length} onClick={() => downloadCSV(`paie-${cur.month}.csv`, slips.map((s) => ({
              matricule: people.find((p) => p.id === s.profile_id)?.matricule, salarie: name(s.profile_id), base: s.base_salary, brut: s.gross,
              cnss: s.cnss_employee, amo: s.amo_employee, ir: s.ir, retenues: s.deductions, net: s.net_pay, charges_patronales: s.employer_charges, cout_total: s.employer_cost,
            })))}>Journal de paie (CSV)</button>
          </div>
        </div>
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Masse salariale brute" value={dh(sum("gross"))} />
          <Kpi label="Net à verser" value={dh(sum("net_pay"))} tone="text-pri-d" />
          <Kpi label="Charges patronales" value={dh(sum("employer_charges"))} />
          <Kpi label="Coût total employeur" value={dh(sum("employer_cost"))} hint={`${slips.length} bulletin(s)`} />
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: "bulletins", label: "Bulletins" }, { key: "variables", label: `Éléments variables (${inputs.length})` }]} />
        <div className="card overflow-x-auto p-0">
          {tab === "bulletins" ? (slips.length === 0 ? <Empty>Cliquez sur « Calculer la paie ».</Empty> : (
            <table className="tbl">
              <thead><tr><th>Salarié</th><th className="text-right">Base</th><th className="text-right">Brut</th><th className="text-right">CNSS+AMO</th><th className="text-right">IR</th><th className="text-right">Retenues</th><th className="text-right">Net</th><th /></tr></thead>
              <tbody>{[...slips].sort((a, b) => name(a.profile_id).localeCompare(name(b.profile_id))).map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{name(s.profile_id)}</td><td className="text-right">{num(s.base_salary, 2)}</td><td className="text-right">{num(s.gross, 2)}</td>
                  <td className="text-right">{num(Number(s.cnss_employee) + Number(s.amo_employee), 2)}</td><td className="text-right">{num(s.ir, 2)}</td>
                  <td className="text-right">{num(s.deductions, 2)}</td><td className="text-right font-semibold">{num(s.net_pay, 2)}</td>
                  <td className="text-right"><button className="btn btn-sm" onClick={() => setView(s)}>Bulletin</button></td>
                </tr>))}</tbody>
            </table>
          )) : (<>
            {canEdit && open && <div className="p-3"><button className="btn-pri btn-sm" onClick={() => setAddInput(true)}>+ Ajouter un élément</button></div>}
            {inputs.length === 0 ? <Empty>Heures sup., primes, avances… Les absences/retards déclarés et le challenge RDV sont pris automatiquement.</Empty> : (
              <table className="tbl">
                <thead><tr><th>Salarié</th><th>Élément</th><th className="text-right">Quantité</th><th className="text-right">Montant</th><th /></tr></thead>
                <tbody>{inputs.map((i) => (
                  <tr key={i.id}><td className="font-medium">{name(i.profile_id)}</td><td>{i.label} <span className="mut">({i.kind})</span></td>
                    <td className="text-right">{i.quantity ?? ""}</td><td className="text-right">{i.amount != null ? dh(i.amount) : ""}</td>
                    <td className="text-right">{canEdit && open && <button className="btn-no btn-sm" onClick={() => run(async () => { must(await supabase.from("payroll_inputs").delete().eq("id", i.id)); await loadPeriod(); }, "Supprimé")}>✕</button>}</td></tr>))}</tbody>
              </table>)}
          </>)}
        </div>
      </>)}
      {view && cur && (
        <Modal title={`Bulletin — ${name(view.profile_id)}`} onClose={() => setView(null)} wide>
          <div id="slip"><PayslipView slip={view} month={cur.month} /></div>
          <div className="mt-3 flex justify-end"><button className="btn-pri" onClick={() => printHtml("Bulletin", document.getElementById("slip")?.innerHTML ?? "")}>Imprimer / PDF</button></div>
        </Modal>
      )}
      {addInput && cur && <InputModal period={cur} people={people} onClose={() => setAddInput(false)} onDone={() => { setAddInput(false); loadPeriod(); }} />}
    </Guard>
  );
}

function InputModal({ period, people, onClose, onDone }: { period: Period; people: Person[]; onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const [who, setWho] = useState("");
  const [code, setCode] = useState("HS25");
  const [label, setLabel] = useState(PRESETS.HS25.label);
  const [qty, setQty] = useState("");
  const [amount, setAmount] = useState("");
  const { busy, run } = useAction();
  const p = PRESETS[code];
  return (
    <Modal title="Élément variable" onClose={onClose}>
      <Field label="Salarié"><select className="inp" value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="">— choisir —</option>{people.map((x) => <option key={x.id} value={x.id}>{fullName(x)}</option>)}</select></Field>
      <Field label="Type"><select className="inp" value={code} onChange={(e) => { setCode(e.target.value); setLabel(PRESETS[e.target.value].label); }}>
        {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
      <Field label="Libellé sur le bulletin"><input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      {p.qty ? <Field label={code === "ABS_NP" ? "Nombre de jours" : "Nombre d'heures"}><input type="number" min={0} step="0.5" className="inp" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        : <Field label="Montant (DH)"><input type="number" min={0} className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
      <div className="flex justify-end"><button className="btn-pri" disabled={busy || !who || !(Number(p.qty ? qty : amount) > 0)} onClick={() => run(async () => {
        must(await supabase.from("payroll_inputs").insert({
          period_id: period.id, profile_id: who, code, label, kind: p.kind, quantity: p.qty ? Number(qty) : null, amount: p.qty ? null : Number(amount),
          cotisable: p.cotisable ?? true, imposable: p.imposable ?? true, created_by: me!.id,
        }));
        onDone();
      }, "Élément ajouté — recalculez la paie")}>Ajouter</button></div>
    </Modal>
  );
}
