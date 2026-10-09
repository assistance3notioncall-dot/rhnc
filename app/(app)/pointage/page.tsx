"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Empty, Field, Kpi, Modal, PageHead, Tabs, useAction } from "@/components/ui";
import { SalaryChangeModal } from "@/components/SalaryChange";
import { dfr, downloadCSV, fullName, monthLabel, monthStart, num, ymd } from "@/lib/format";

type Person = { id: string; first_name: string; last_name: string; matricule: string | null };
type Ev = { id: number; profile_id: string; event_date: string; kind: string; minutes: number | null; days: number | null; justified: boolean; reason: string | null };
type Sum = { profile_id: string; nb_retards: number; minutes_retard: number; minutes_depart: number; jours_absence_justifiee: number; jours_absence_injustifiee: number; max_absences_consecutives: number };
const KLABEL: Record<string, string> = { retard: "Retard", absence: "Absence", depart_anticipe: "Départ anticipé" };

function assiduite(s?: Sum) {
  if (!s) return { label: "100 %", cls: "bg-ok-l text-ok" };
  if (s.jours_absence_injustifiee > 0 || s.minutes_retard > 180) return { label: "Perdue", cls: "bg-err-l text-err" };
  if (s.minutes_retard >= 60) return { label: "−30 %", cls: "bg-warn-l text-warn" };
  return { label: "100 %", cls: "bg-ok-l text-ok" };
}

export default function Pointage() {
  const { me, can } = useSession();
  const canEdit = can("pointage", true);
  const [month, setMonth] = useState(monthStart());
  const [people, setPeople] = useState<Person[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [sums, setSums] = useState<Sum[]>([]);
  const [tab, setTab] = useState("synthese");
  const [form, setForm] = useState<Partial<Ev> | null>(null);
  const [salFor, setSalFor] = useState<Person | null>(null);
  const { busy, run } = useAction();

  const end = useMemo(() => { const d = new Date(month + "T12:00:00"); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }, [month]);

  const load = useCallback(async () => {
    const [{ data: p }, { data: e }, { data: s }] = await Promise.all([
      supabase.from("profiles").select("id,first_name,last_name,matricule").eq("status", "actif").order("first_name"),
      supabase.from("attendance_events").select("*").gte("event_date", month).lte("event_date", end).order("event_date", { ascending: false }),
      supabase.from("attendance_month").select("*").eq("month", month),
    ]);
    setPeople(((p as Person[]) ?? []).filter((x) => x.id !== me?.id));
    setEvents((e as Ev[]) ?? []);
    setSums((s as Sum[]) ?? []);
  }, [month, end, me]);
  useEffect(() => { load(); }, [load]);

  const name = (id: string) => fullName(people.find((p) => p.id === id));
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); return monthStart(new Date(d.getFullYear(), d.getMonth() - i, 1)); });
  const tot = sums.reduce((a, s) => ({ r: a.r + s.nb_retards, m: a.m + s.minutes_retard, a: a.a + Number(s.jours_absence_injustifiee) }), { r: 0, m: 0, a: 0 });

  return (
    <Guard module="pointage">
      <PageHead title="Absences & retards" sub="Déclarations du manager / super admin — impactent la prime d'assiduité et la paie.">
        <select className="inp w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button className="btn" onClick={() => downloadCSV(`pointage-${month}.csv`, sums.map((s) => ({ salarie: name(s.profile_id), ...s })))}>Export CSV</button>
        {canEdit && <button className="btn-pri" onClick={() => setForm({ kind: "retard", event_date: ymd(new Date()), justified: false })}>+ Déclarer</button>}
      </PageHead>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Kpi label="Retards du mois" value={tot.r} hint={`${num(tot.m)} minutes cumulées`} tone="text-warn" />
        <Kpi label="Jours d'absence non justifiée" value={num(tot.a, 1)} hint="déduits de la paie" tone="text-err" />
        <Kpi label="Salariés concernés" value={sums.length} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "synthese", label: "Synthèse par salarié" }, { key: "journal", label: "Journal" }, ...(can("salaire_base") ? [{ key: "salaire", label: "Salaire de base" }] : [])]} />
      <div className="card overflow-x-auto p-0">
        {tab === "salaire" ? (
          <table className="tbl">
            <thead><tr><th>Salarié</th><th>Matricule</th><th /></tr></thead>
            <tbody>{people.map((p) => (
              <tr key={p.id}><td className="font-medium">{fullName(p)}</td><td className="mut">{p.matricule}</td>
                <td className="text-right"><button className="btn btn-sm" onClick={() => setSalFor(p)}>{can("salaire_base", true) ? "Modifier le salaire" : "Proposer un changement"}</button></td></tr>
            ))}</tbody>
          </table>
        ) : tab === "synthese" ? (sums.length === 0 ? <Empty>Aucune déclaration ce mois-ci.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Salarié</th><th className="text-right">Retards</th><th className="text-right">Minutes</th><th className="text-right">Départs (min)</th><th className="text-right">Abs. justifiées</th><th className="text-right">Abs. non justifiées</th><th>Prime d&apos;assiduité</th></tr></thead>
            <tbody>{sums.map((s) => { const a = assiduite(s); return (
              <tr key={s.profile_id}>
                <td className="font-medium">{name(s.profile_id)}</td>
                <td className="text-right">{s.nb_retards}</td><td className="text-right">{s.minutes_retard}</td><td className="text-right">{s.minutes_depart}</td>
                <td className="text-right">{num(s.jours_absence_justifiee, 1)}</td><td className="text-right">{num(s.jours_absence_injustifiee, 1)}</td>
                <td><span className={`badge ${a.cls}`}>{a.label}</span>{s.max_absences_consecutives >= 2 && <span className="badge ml-1 bg-err-l text-err">Abandon ? ({s.max_absences_consecutives} j)</span>}</td>
              </tr>); })}</tbody>
          </table>
        )) : (events.length === 0 ? <Empty>Aucune déclaration ce mois-ci.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Date</th><th>Salarié</th><th>Type</th><th>Durée</th><th>Justifié</th><th>Motif</th><th /></tr></thead>
            <tbody>{events.map((e) => (
              <tr key={e.id}>
                <td>{dfr(e.event_date)}</td><td className="font-medium">{name(e.profile_id)}</td><td>{KLABEL[e.kind]}</td>
                <td>{e.kind === "absence" ? (e.days === 0.5 ? "½ journée" : "1 jour") : `${e.minutes} min`}</td>
                <td>{e.justified ? <span className="badge bg-ok-l text-ok">Oui</span> : <span className="badge bg-gray2-l text-gray2">Non</span>}</td>
                <td className="mut">{e.reason}</td>
                <td className="whitespace-nowrap text-right">{canEdit && <>
                  <button className="btn btn-sm" onClick={() => setForm(e)}>Modifier</button>
                  <button className="btn-no btn-sm ml-1" disabled={busy} onClick={() => confirm("Supprimer cette déclaration ?") && run(async () => { must(await supabase.from("attendance_events").delete().eq("id", e.id)); await load(); }, "Supprimé")}>✕</button>
                </>}</td>
              </tr>))}</tbody>
          </table>
        ))}
      </div>
      <p className="mut mt-3 text-[12.5px]">Règle : ≥ 60 min de retard cumulé → prime d&apos;assiduité −30 % · &gt; 180 min ou une absence non justifiée → prime perdue · absence non justifiée = journée déduite.</p>

      {salFor && <SalaryChangeModal person={{ id: salFor.id, name: fullName(salFor) }} onClose={() => setSalFor(null)} onDone={() => setSalFor(null)} />}
      {form && (
        <Modal title={form.id ? "Modifier la déclaration" : "Déclarer une absence / un retard"} onClose={() => setForm(null)}>
          <Field label="Salarié">
            <select className="inp" value={form.profile_id ?? ""} disabled={!!form.id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })}>
              <option value="">— choisir —</option>
              {people.map((p) => <option key={p.id} value={p.id}>{fullName(p)}{p.matricule ? ` (${p.matricule})` : ""}</option>)}
            </select>
          </Field>
          <Tabs value={form.kind ?? "retard"} onChange={(k) => setForm({ ...form, kind: k })} tabs={Object.entries(KLABEL).map(([key, label]) => ({ key, label }))} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" className="inp" max={ymd(new Date())} value={form.event_date ?? ""} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></Field>
            {form.kind === "absence" ? (
              <Field label="Durée"><select className="inp" value={form.days ?? 1} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
                <option value={1}>1 jour</option><option value={0.5}>½ journée</option></select></Field>
            ) : (
              <Field label="Minutes"><input type="number" min={1} className="inp" value={form.minutes ?? ""} onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })} /></Field>
            )}
          </div>
          <label className="mb-3 flex items-center gap-2"><input type="checkbox" checked={!!form.justified} onChange={(e) => setForm({ ...form, justified: e.target.checked })} /> Justifié(e)</label>
          <Field label="Motif / commentaire"><input className="inp" value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          <div className="flex justify-end">
            <button className="btn-pri" disabled={busy || !form.profile_id || !form.event_date || (form.kind !== "absence" && !(Number(form.minutes) > 0))}
              onClick={() => run(async () => {
                const row = {
                  company_id: me!.company_id, profile_id: form.profile_id, event_date: form.event_date, kind: form.kind, justified: !!form.justified, reason: form.reason || null,
                  minutes: form.kind === "absence" ? null : Number(form.minutes), days: form.kind === "absence" ? Number(form.days ?? 1) : null,
                };
                if (form.id) must(await supabase.from("attendance_events").update(row).eq("id", form.id));
                else must(await supabase.from("attendance_events").insert(row));
                setForm(null); await load();
              }, "Déclaration enregistrée — le salarié est notifié")}>Enregistrer</button>
          </div>
        </Modal>
      )}
    </Guard>
  );
}
