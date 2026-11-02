"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
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

type Cell = { rdv: number; ok: number };
/** Tableau croisé : une ligne par entité, une colonne par semaine (onglet APPT) + total du mois. */
function pivot<T extends { week_label: string; rdv: number; ok: number }>(rows: T[], key: (r: T) => string, label: (r: T) => string, weekOrder: (w: string) => number) {
  const weeks = [...new Set(rows.map((r) => r.week_label))].sort((a, b) => weekOrder(a) - weekOrder(b) || a.localeCompare(b));
  const m = new Map<string, { key: string; label: string; cells: Record<string, Cell>; tot: Cell }>();
  for (const r of rows) {
    const k = key(r);
    const cur = m.get(k) ?? { key: k, label: label(r), cells: {}, tot: { rdv: 0, ok: 0 } };
    const c = cur.cells[r.week_label] ?? (cur.cells[r.week_label] = { rdv: 0, ok: 0 });
    c.rdv += Number(r.rdv); c.ok += Number(r.ok ?? 0); cur.tot.rdv += Number(r.rdv); cur.tot.ok += Number(r.ok ?? 0);
    m.set(k, cur);
  }
  const lines = [...m.values()].sort((a, b) => b.tot.rdv - a.tot.rdv);
  const total = { cells: Object.fromEntries(weeks.map((w) => [w, lines.reduce((a, l) => ({ rdv: a.rdv + (l.cells[w]?.rdv ?? 0), ok: a.ok + (l.cells[w]?.ok ?? 0) }), { rdv: 0, ok: 0 })])) as Record<string, Cell>,
    tot: lines.reduce((a, l) => ({ rdv: a.rdv + l.tot.rdv, ok: a.ok + l.tot.ok }), { rdv: 0, ok: 0 }) };
  return { weeks, lines, total };
}

function WeekTable({ title, data, csv }: { title: string; data: ReturnType<typeof pivot>; csv: string }) {
  const { weeks, lines, total } = data;
  if (!lines.length) return <Empty>Aucune donnée.</Empty>;
  const cell = (c?: Cell) => c && c.rdv ? (<><div className="font-semibold">{c.rdv}</div><div className="mut text-[11.5px]">{num(c.ok, 1)} OK · {rate(c.ok, c.rdv)}</div></>) : <span className="mut">—</span>;
  return (<>
    <div className="flex justify-end p-3 pb-0"><button className="btn btn-sm" onClick={() => downloadCSV(csv, lines.map((l) => ({
      [title]: l.label, ...Object.fromEntries(weeks.flatMap((w) => [[`${w} RDV`, l.cells[w]?.rdv ?? 0], [`${w} OK`, l.cells[w]?.ok ?? 0]])), total_rdv: l.tot.rdv, total_ok: l.tot.ok,
    })))}>Export CSV (par semaine)</button></div>
    <table className="tbl [&_th]:sticky [&_th]:top-0 [&_th]:z-10">
      <thead><tr><th>{title}</th>{weeks.map((w) => <th key={w} className="text-right">{w}</th>)}<th className="text-right">Total mois</th></tr></thead>
      <tbody>
        {lines.map((l) => <tr key={l.key}><td className="font-medium">{l.label || "—"}</td>
          {weeks.map((w) => <td key={w} className="text-right align-top">{cell(l.cells[w])}</td>)}
          <td className="text-right align-top bg-[#fafbfd]">{cell(l.tot)}</td></tr>)}
        <tr className="border-t-2 border-line"><td className="font-bold">Total</td>
          {weeks.map((w) => <td key={w} className="text-right align-top">{cell(total.cells[w])}</td>)}
          <td className="text-right align-top bg-[#fafbfd]">{cell(total.tot)}</td></tr>
      </tbody>
    </table>
  </>);
}

export default function Stats() {
  const [month, setMonth] = useState(monthStart());
  const [tab, setTab] = useState("classement");
  const [am, setAm] = useState<AM[]>([]);
  const [pa, setPa] = useState<PA[]>([]);
  const [pc, setPc] = useState<PC[]>([]);
  const [ps, setPs] = useState<PS[]>([]);
  const [weeks, setWeeks] = useState<W[]>([]);
  const [cat, setCat] = useState("tous");
  // Vue des onglets Perf : total du mois ou détail semaine par semaine
  const [byWeek, setByWeek] = useState(true);

  useEffect(() => {
    supabase.from("stats_agent_month").select("*").eq("month", month).order("rang").then(({ data }) => setAm((data as AM[]) ?? []));
    supabase.from("perf_agents").select("*").eq("month", month).then(({ data }) => setPa((data as PA[]) ?? []));
    supabase.from("perf_confirmeurs").select("*").eq("month", month).then(({ data }) => setPc((data as PC[]) ?? []));
    supabase.from("perf_societes").select("*").eq("month", month).then(({ data }) => setPs((data as PS[]) ?? []));
    supabase.from("rdv_weeks").select("*").order("week_start", { ascending: false }).limit(60).then(({ data }) => setWeeks((data as W[]) ?? []));
  }, [month]);

  const months = Array.from({ length: 8 }, (_, i) => { const d = new Date(); return monthStart(new Date(d.getFullYear(), d.getMonth() - i, 1)); });
  const ranking = am.filter((r) => cat === "tous" || r.category === cat);
  const perfA = useMemo(() => group(pa, (r) => r.agent_code, (r) => ({ name: r.agent_name, category: r.category })), [pa]);
  const perfC = useMemo(() => group(pc, (r) => r.confirmeur), [pc]);
  const perfS = useMemo(() => group(ps, (r) => r.societe), [ps]);
  const weekStart = useMemo(() => Object.fromEntries(weeks.map((w) => [w.week_label, new Date(w.week_start).getTime()])), [weeks]);
  const weekOrder = useCallback((w: string) => weekStart[w] ?? Number(w.replace(/\D/g, "")) ?? 0, [weekStart]);
  const wkA = useMemo(() => pivot(pa.filter((r) => cat === "tous" || r.category === cat), (r) => r.agent_code, (r) => r.agent_name, weekOrder), [pa, cat, weekOrder]);
  const wkC = useMemo(() => pivot(pc, (r) => r.confirmeur, (r) => r.confirmeur, weekOrder), [pc, weekOrder]);
  const wkS = useMemo(() => pivot(ps, (r) => r.societe, (r) => r.societe, weekOrder), [ps, weekOrder]);
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
      {["agents", "confirmeurs", "societes"].includes(tab) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button className={byWeek ? "chip-on" : "chip"} onClick={() => setByWeek(true)}>Par semaine</button>
          <button className={!byWeek ? "chip-on" : "chip"} onClick={() => setByWeek(false)}>Total du mois</button>
          {tab === "agents" && byWeek && <span className="ml-2 flex gap-2">{["tous", "agent", "qualif", "soustraitant"].map((c) => <button key={c} className={cat === c ? "chip-on" : "chip"} onClick={() => setCat(c)}>{c === "tous" ? "Tous" : c}</button>)}</span>}
        </div>)}
      <div className="card max-h-[calc(100vh-9rem)] overflow-auto p-0">
        {tab === "classement" && (<>
          <div className="flex gap-2 p-3">{["tous", "agent", "qualif", "soustraitant"].map((c) => <button key={c} className={cat === c ? "chip-on" : "chip"} onClick={() => setCat(c)}>{c === "tous" ? "Tous" : c}</button>)}</div>
          {ranking.length === 0 ? <Empty>Aucune donnée pour ce mois.</Empty> : (
            <table className="tbl"><thead><tr><th>#</th><th>Agent</th><th>Catégorie</th><th className="text-right">RDV</th><th className="text-right">Challenge</th></tr></thead>
              <tbody>{ranking.map((r) => (
                <tr key={r.agent_code}><td className="font-bold">{r.rang <= 3 ? ["🥇", "🥈", "🥉"][r.rang - 1] : r.rang}</td><td className="font-medium">{r.agent_name}</td>
                  <td className="mut">{r.category}</td><td className="text-right font-semibold">{r.rdv}</td><td className="text-right">{dh(r.challenge)}</td></tr>))}
              </tbody></table>)}
        </>)}
        {tab === "agents" && byWeek && <WeekTable title="Agent" data={wkA} csv={`perf-agents-semaines-${month}.csv`} />}
        {tab === "confirmeurs" && byWeek && <WeekTable title="Confirmeur" data={wkC} csv={`perf-confirmeurs-semaines-${month}.csv`} />}
        {tab === "societes" && byWeek && <WeekTable title="Société" data={wkS} csv={`perf-societes-semaines-${month}.csv`} />}
        {tab === "agents" && !byWeek && (perfA.length === 0 ? <Empty>Aucune donnée.</Empty> : (
          <table className="tbl"><thead><tr><th>Agent</th><th>Catégorie</th><th className="text-right">RDV</th><th className="text-right">OK</th><th className="text-right">Taux</th></tr></thead>
            <tbody>{perfA.map((r) => <tr key={r.key}><td className="font-medium">{String(r.meta.name)}</td><td className="mut">{String(r.meta.category)}</td><td className="text-right">{r.rdv}</td><td className="text-right">{num(r.ok, 1)}</td><td className="text-right font-semibold">{rate(r.ok, r.rdv)}</td></tr>)}</tbody></table>))}
        {tab === "confirmeurs" && !byWeek && (perfC.length === 0 ? <Empty>Aucune donnée.</Empty> : (
          <table className="tbl"><thead><tr><th>Confirmeur</th><th className="text-right">RDV</th><th className="text-right">OK</th><th className="text-right">Taux</th></tr></thead>
            <tbody>{perfC.map((r) => <tr key={r.key}><td className="font-medium">{r.key || "—"}</td><td className="text-right">{r.rdv}</td><td className="text-right">{num(r.ok, 1)}</td><td className="text-right font-semibold">{rate(r.ok, r.rdv)}</td></tr>)}</tbody></table>))}
        {tab === "societes" && !byWeek && (perfS.length === 0 ? <Empty>Aucune donnée.</Empty> : (
          <table className="tbl"><thead><tr><th>Société</th><th className="text-right">RDV</th><th className="text-right">OK</th><th className="text-right">Taux</th></tr></thead>
            <tbody>{perfS.map((r) => <tr key={r.key}><td className="font-medium">{r.key}</td><td className="text-right">{r.rdv}</td><td className="text-right">{num(r.ok, 1)}</td><td className="text-right font-semibold">{rate(r.ok, r.rdv)}</td></tr>)}</tbody></table>))}
        {tab === "imports" && (weeks.length === 0 ? <Empty>Aucune semaine importée. Lancez SyncSupabase depuis la feuille APPT.</Empty> : (
          <table className="tbl"><thead><tr><th>Onglet APPT</th><th>Début de semaine</th><th className="text-right">Lignes</th><th>Importé le</th></tr></thead>
            <tbody>{weeks.map((w) => <tr key={w.id}><td className="font-medium">{w.week_label}</td><td>{w.week_start}</td><td className="text-right">{w.row_count}</td><td className="mut">{dtfr(w.imported_at)}</td></tr>)}</tbody></table>))}
      </div>
    </Guard>
  );
}
