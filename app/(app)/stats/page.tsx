"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Guard } from "@/components/Guard";
import { Empty, Kpi, PageHead, Tabs } from "@/components/ui";
import { dh, downloadCSV, dtfr, monthLabel, monthStart, num } from "@/lib/format";

type AM = { agent_code: string; agent_name: string; category: string; rdv: number; challenge: number; rang: number };
type PA = { agent_code: string; agent_name: string; category: string; week_label: string; rdv: number; ok: number };
type PC = { confirmeur: string; societe: string; week_label: string; rdv: number; ok: number };
type PS = { societe: string; week_label: string; rdv: number; ok: number };
type W = { id: string; week_label: string; week_start: string; row_count: number; imported_at: string };

function group<T, K extends string>(rows: T[], key: (r: T) => K, extra?: (r: T) => Record<string, unknown>) {
  const m = new Map<string, { key: string; rdv: number; ok: number; meta: Record<string, unknown> }>();
  for (const r of rows as (T & { rdv: number; ok: number })[]) {
    const k = key(r);
    const cur = m.get(k) ?? { key: k, rdv: 0, ok: 0, meta: extra?.(r) ?? {} };
    cur.rdv += Number(r.rdv); cur.ok += Number(r.ok ?? 0);
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.rdv - a.rdv);
}
const rate = (ok: number, rdv: number) => (rdv ? num((ok / rdv) * 100, 1) + " %" : "—");

export default function Stats() {
  const [month, setMonth] = useState(monthStart());
  const [tab, setTab] = useState("classement");
  const [am, setAm] = useState<AM[]>([]);
  const [pa, setPa] = useState<PA[]>([]);
  const [pc, setPc] = useState<PC[]>([]);
  const [ps, setPs] = useState<PS[]>([]);
  const [weeks, setWeeks] = useState<W[]>([]);
  const [cat, setCat] = useState("tous");

  useEffect(() => {
    supabase.from("stats_agent_month").select("*").eq("month", month).order("rang").then(({ data }) => setAm((data as AM[]) ?? []));
    supabase.from("perf_agents").select("*").eq("month", month).then(({ data }) => setPa((data as PA[]) ?? []));
    supabase.from("perf_confirmeurs").select("*").eq("month", month).then(({ data }) => setPc((data as PC[]) ?? []));
    supabase.from("perf_societes").select("*").eq("month", month).then(({ data }) => setPs((data as PS[]) ?? []));
    supabase.from("rdv_weeks").select("*").order("week_start", { ascending: false }).limit(20).then(({ data }) => setWeeks((data as W[]) ?? []));
  }, [month]);

  const months = Array.from({ length: 8 }, (_, i) => { const d = new Date(); return monthStart(new Date(d.getFullYear(), d.getMonth() - i, 1)); });
  const ranking = am.filter((r) => cat === "tous" || r.category === cat);
  const perfA = useMemo(() => group(pa, (r) => r.agent_code, (r) => ({ name: r.agent_name, category: r.category })), [pa]);
  const perfC = useMemo(() => group(pc, (r) => r.confirmeur), [pc]);
  const perfS = useMemo(() => group(ps, (r) => r.societe), [ps]);
  const totalRdv = am.reduce((a, r) => a + r.rdv, 0);
  const totalCh = am.reduce((a, r) => a + Number(r.challenge), 0);
  const totOk = perfS.reduce((a, r) => a + r.ok, 0), totPerf = perfS.reduce((a, r) => a + r.rdv, 0);

  return (
    <Guard module="stats">
      <PageHead title="Stats RDV" sub="Alimenté automatiquement depuis la feuille APPT (script SyncSupabase).">
        <select className="inp w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button className="btn" onClick={() => downloadCSV(`stats-${month}.csv`, am as unknown as Record<string, unknown>[])}>Export CSV</button>
      </PageHead>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="RDV du mois" value={num(totalRdv)} tone="text-pri-d" />
        <Kpi label="Taux OK (pondéré)" value={rate(totOk, totPerf)} tone="text-ok" hint="OK, F.R, N.O = 1 · N.T = 0,5" />
        <Kpi label="Challenge à verser" value={dh(totalCh)} />
        <Kpi label="Agents actifs" value={am.length} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "classement", label: "Classement & challenge" }, { key: "agents", label: "Perf agents" },
        { key: "confirmeurs", label: "Perf confirmeurs" }, { key: "societes", label: "Perf sociétés" }, { key: "imports", label: "Imports" },
      ]} />
      <div className="card overflow-x-auto p-0">
        {tab === "classement" && (<>
          <div className="flex gap-2 p-3">{["tous", "agent", "qualif", "soustraitant"].map((c) => <button key={c} className={cat === c ? "chip-on" : "chip"} onClick={() => setCat(c)}>{c === "tous" ? "Tous" : c}</button>)}</div>
          {ranking.length === 0 ? <Empty>Aucune donnée pour ce mois.</Empty> : (
            <table className="tbl"><thead><tr><th>#</th><th>Agent</th><th>Catégorie</th><th className="text-right">RDV</th><th className="text-right">Challenge</th></tr></thead>
              <tbody>{ranking.map((r) => (
                <tr key={r.agent_code}><td className="font-bold">{r.rang <= 3 ? ["🥇", "🥈", "🥉"][r.rang - 1] : r.rang}</td><td className="font-medium">{r.agent_name}</td>
                  <td className="mut">{r.category}</td><td className="text-right font-semibold">{r.rdv}</td><td className="text-right">{dh(r.challenge)}</td></tr>))}
              </tbody></table>)}
        </>)}
        {tab === "agents" && (perfA.length === 0 ? <Empty>Aucune donnée.</Empty> : (
          <table className="tbl"><thead><tr><th>Agent</th><th>Catégorie</th><th className="text-right">RDV</th><th className="text-right">OK</th><th className="text-right">Taux</th></tr></thead>
            <tbody>{perfA.map((r) => <tr key={r.key}><td className="font-medium">{String(r.meta.name)}</td><td className="mut">{String(r.meta.category)}</td><td className="text-right">{r.rdv}</td><td className="text-right">{num(r.ok, 1)}</td><td className="text-right font-semibold">{rate(r.ok, r.rdv)}</td></tr>)}</tbody></table>))}
        {tab === "confirmeurs" && (perfC.length === 0 ? <Empty>Aucune donnée.</Empty> : (
          <table className="tbl"><thead><tr><th>Confirmeur</th><th className="text-right">RDV</th><th className="text-right">OK</th><th className="text-right">Taux</th></tr></thead>
            <tbody>{perfC.map((r) => <tr key={r.key}><td className="font-medium">{r.key || "—"}</td><td className="text-right">{r.rdv}</td><td className="text-right">{num(r.ok, 1)}</td><td className="text-right font-semibold">{rate(r.ok, r.rdv)}</td></tr>)}</tbody></table>))}
        {tab === "societes" && (perfS.length === 0 ? <Empty>Aucune donnée.</Empty> : (
          <table className="tbl"><thead><tr><th>Société</th><th className="text-right">RDV</th><th className="text-right">OK</th><th className="text-right">Taux</th></tr></thead>
            <tbody>{perfS.map((r) => <tr key={r.key}><td className="font-medium">{r.key}</td><td className="text-right">{r.rdv}</td><td className="text-right">{num(r.ok, 1)}</td><td className="text-right font-semibold">{rate(r.ok, r.rdv)}</td></tr>)}</tbody></table>))}
        {tab === "imports" && (weeks.length === 0 ? <Empty>Aucune semaine importée. Lancez SyncSupabase depuis la feuille APPT.</Empty> : (
          <table className="tbl"><thead><tr><th>Onglet APPT</th><th>Début de semaine</th><th className="text-right">Lignes</th><th>Importé le</th></tr></thead>
            <tbody>{weeks.map((w) => <tr key={w.id}><td className="font-medium">{w.week_label}</td><td>{w.week_start}</td><td className="text-right">{w.row_count}</td><td className="mut">{dtfr(w.imported_at)}</td></tr>)}</tbody></table>))}
      </div>
    </Guard>
  );
}
