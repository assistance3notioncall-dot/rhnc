"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Guard } from "@/components/Guard";
import { Kpi, PageHead } from "@/components/ui";
import { dh, downloadCSV, monthLabel, num } from "@/lib/format";

type Emp = { id: string; role_label: string | null; section: string | null; status: string; account_status: string; hire_date: string | null };
type Req = { days: number | null; start_date: string; leave_type: { label: string; color: string } | null };
type Period = { id: string; month: string; status: string };

function Bars({ data, color = "#2563eb", fmt = (n: number) => num(n, 1) }: { data: [string, number][]; color?: string; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d[1]));
  return (
    <div className="space-y-2">
      {data.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)_80px] items-center gap-2 text-[13px]">
          <span className="truncate">{k}</span>
          <div className="h-2.5 rounded-full bg-gray2-l"><div className="h-2.5 rounded-full" style={{ width: `${(v / max) * 100}%`, background: color }} /></div>
          <span className="text-right font-semibold">{fmt(v)}</span>
        </div>
      ))}
      {data.length === 0 && <p className="mut">Aucune donnée.</p>}
    </div>
  );
}
const count = <T,>(rows: T[], key: (r: T) => string, val: (r: T) => number = () => 1) => {
  const m: Record<string, number> = {};
  rows.forEach((r) => { const k = key(r); m[k] = (m[k] ?? 0) + val(r); });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};

export default function Rapports() {
  const [emps, setEmps] = useState<Emp[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [mass, setMass] = useState<[string, number][]>([]);
  const year = new Date().getFullYear();

  useEffect(() => {
    supabase.from("employees_access").select("id,role_label,section,status,account_status,hire_date").then(({ data }) => setEmps((data as Emp[]) ?? []));
    supabase.from("requests").select("days,start_date,leave_type:leave_types(label,color)").eq("kind", "absence").in("status", ["valid_rh", "traitee"]).gte("start_date", `${year}-01-01`)
      .then(({ data }) => setReqs((data as unknown as Req[]) ?? []));
    (async () => {
      const { data: per } = await supabase.from("payroll_periods").select("id,month,status").order("month").limit(12);
      const out: [string, number][] = [];
      for (const p of (per as Period[]) ?? []) {
        const { data: s } = await supabase.from("payslips").select("employer_cost").eq("period_id", p.id);
        out.push([monthLabel(p.month), (s ?? []).reduce((a, x) => a + Number(x.employer_cost), 0)]);
      }
      setMass(out);
    })();
  }, [year]);

  const active = emps.filter((e) => e.status === "actif");
  const absDays = reqs.reduce((a, r) => a + Number(r.days ?? 0), 0);

  return (
    <Guard module="rapports">
      <PageHead title="Rapports" sub={`Effectifs, absentéisme et masse salariale — ${year}.`}>
        <button className="btn" onClick={() => downloadCSV("effectifs.csv", emps as unknown as Record<string, unknown>[])}>Effectifs (CSV)</button>
        <button className="btn" onClick={() => downloadCSV("absences.csv", reqs.map((r) => ({ type: r.leave_type?.label, debut: r.start_date, jours: r.days })))}>Absences (CSV)</button>
      </PageHead>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Effectif actif" value={active.length} />
        <Kpi label="Comptes actifs" value={emps.filter((e) => e.account_status === "actif").length} hint={`${emps.filter((e) => e.account_status === "sans_compte").length} sans accès`} />
        <Kpi label="Jours d'absence validés" value={num(absDays, 1)} hint={`depuis janvier ${year}`} />
        <Kpi label="Embauches cette année" value={emps.filter((e) => e.hire_date?.startsWith(String(year))).length} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card"><h2 className="mb-3">Effectif par section</h2><Bars data={count(active, (e) => e.section ?? "—")} fmt={(n) => String(n)} /></div>
        <div className="card"><h2 className="mb-3">Effectif par rôle</h2><Bars data={count(active, (e) => e.role_label ?? "—")} color="#0f766e" fmt={(n) => String(n)} /></div>
        <div className="card"><h2 className="mb-3">Jours d&apos;absence par type</h2><Bars data={count(reqs, (r) => r.leave_type?.label ?? "—", (r) => Number(r.days ?? 0))} color="#b45309" /></div>
        <div className="card"><h2 className="mb-3">Coût employeur par mois</h2><Bars data={mass} color="#7c3aed" fmt={(n) => dh(n)} /></div>
      </div>
    </Guard>
  );
}
