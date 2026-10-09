"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Empty, Kpi, PageHead } from "@/components/ui";
import { dfr, dh, monthLabel, monthStart } from "@/lib/format";

type M = { month: string; agent_code: string; rdv: number; challenge: number; rang: number; category: string };
type D = { rdv_date: string; day_name: string; week_label: string; rdv: number; has_dollar: boolean; challenge: number };

export default function MesRdv() {
  const { me } = useSession();
  const [months, setMonths] = useState<M[]>([]);
  const [month, setMonth] = useState(monthStart());
  const [days, setDays] = useState<D[]>([]);

  useEffect(() => {
    if (!me) return;
    supabase.from("stats_agent_month").select("*").eq("profile_id", me.id).order("month", { ascending: false }).limit(12)
      .then(({ data }) => { setMonths((data as M[]) ?? []); if (data?.[0] && !data.find((x) => x.month === month)) setMonth(data[0].month); });
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!me) return;
    supabase.from("stats_agent_day").select("*").eq("profile_id", me.id).eq("month", month).order("rdv_date").then(({ data }) => setDays((data as D[]) ?? []));
  }, [me, month]);

  const cur = months.find((m) => m.month === month);
  const best = days.reduce((a, d) => Math.max(a, d.rdv), 0);

  return (
    <Guard module="mesrdv">
      <PageHead title="Mes RDV & challenge" sub="Calculé chaque semaine depuis la feuille APPT.">
        <select className="inp w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
          {[...new Set([monthStart(), ...months.map((m) => m.month)])].map((m) => <option key={m} value={m} className="capitalize">{monthLabel(m)}</option>)}
        </select>
      </PageHead>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="RDV du mois" value={cur?.rdv ?? 0} tone="text-pri-d" />
        <Kpi label="Challenge cumulé" value={dh(cur?.challenge ?? 0)} tone="text-ok" />
        <Kpi label="Classement" value={cur ? `#${cur.rang}` : "—"} hint={cur?.category} />
        <Kpi label="Meilleure journée" value={best} hint="RDV" />
      </div>
      <div className="card mt-4 overflow-x-auto p-0">
        {days.length === 0 ? <Empty>Pas encore de RDV importés pour ce mois.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Date</th><th>Semaine</th><th className="text-right">RDV</th><th>$</th><th className="text-right">Challenge</th></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.rdv_date}>
                  <td className="capitalize">{d.day_name} {dfr(d.rdv_date)}</td>
                  <td className="mut">{d.week_label}</td>
                  <td className="text-right font-semibold">{d.rdv}</td>
                  <td>{d.has_dollar ? "✓" : ""}</td>
                  <td className="text-right">{dh(d.challenge)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mut mt-3 text-[12.5px]">Barème par défaut : 3 RDV (avec $) = 50 DH · 4 = 100 · 5 = 200 · au-delà +50 DH par RDV. Les RDV roses ne comptent pas (sauf verdict vert).</p>
    </Guard>
  );
}
