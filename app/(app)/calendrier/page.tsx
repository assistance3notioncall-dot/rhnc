"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { PageHead } from "@/components/ui";
import { num, ymd } from "@/lib/format";

type Abs = { id: string; profile_id: string; first_name: string; last_name: string; start_date: string; end_date: string; type_code: string; color: string; status: string };
type Hol = { day: string; label: string; confirmed: boolean };
type Bal = { label: string; color: string; solde: number };
const DOW = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export default function Calendrier() {
  const { me } = useSession();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [abs, setAbs] = useState<Abs[]>([]);
  const [hol, setHol] = useState<Hol[]>([]);
  const [bal, setBal] = useState<Bal[]>([]);

  const first = ymd(cursor);
  const last = ymd(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));

  useEffect(() => {
    supabase.from("team_absences").select("*").lte("start_date", last).gte("end_date", first).then(({ data }) => setAbs((data as Abs[]) ?? []));
    supabase.from("holidays").select("day,label,confirmed").gte("day", first).lte("day", last).then(({ data }) => setHol((data as Hol[]) ?? []));
  }, [first, last]);

  useEffect(() => {
    if (!me) return;
    (async () => {
      const { data: types } = await supabase.from("leave_types").select("id,label,color").eq("deducts_balance", true).eq("active", true).order("sort");
      const out: Bal[] = [];
      for (const t of types ?? []) {
        const { data } = await supabase.rpc("balance_of", { p_profile: me.id, p_leave_type: t.id });
        out.push({ label: t.label, color: t.color, solde: Number(data ?? 0) });
      }
      setBal(out);
    })();
  }, [me]);

  const cells = useMemo(() => {
    const lead = (cursor.getDay() + 6) % 7;
    const n = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))];
  }, [cursor]);

  const move = (k: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + k, 1));

  return (
    <Guard module="calendrier">
      <PageHead title="Congés & calendrier" sub="Absences de l'équipe, jours fériés et vos soldes.">
        <button className="btn" onClick={() => move(-1)}>←</button>
        <span className="btn pointer-events-none min-w-40 justify-center capitalize">{cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span>
        <button className="btn" onClick={() => move(1)}>→</button>
      </PageHead>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="card overflow-x-auto p-3">
          <div className="grid min-w-[640px] grid-cols-7 gap-1">
            {DOW.map((d) => <div key={d} className="mut py-1 text-center text-[12px] font-semibold">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={"e" + i} />;
              const s = ymd(d);
              const h = hol.find((x) => x.day === s);
              const list = abs.filter((a) => a.start_date <= s && a.end_date >= s);
              const sunday = d.getDay() === 0;
              const today = s === ymd(new Date());
              return (
                <div key={s} className={`min-h-[92px] rounded-lg border p-1.5 ${today ? "border-pri" : "border-line"} ${sunday ? "bg-gray2-l" : h ? "bg-warn-l" : "bg-white"}`}>
                  <div className="text-[12px] font-semibold">{d.getDate()}</div>
                  {h && <div className="truncate text-[11px] text-warn" title={h.label}>{h.label}{h.confirmed ? "" : " *"}</div>}
                  {!sunday && list.slice(0, 3).map((a) => (
                    <div key={a.id} className="mt-0.5 truncate rounded px-1 text-[11px]" style={{ background: a.color + "55" }} title={`${a.first_name} ${a.last_name} · ${a.type_code}`}>
                      {a.first_name} {a.last_name?.[0] ?? ""}.
                    </div>
                  ))}
                  {!sunday && list.length > 3 && <div className="mut text-[11px]">+{list.length - 3}</div>}
                </div>
              );
            })}
          </div>
          <p className="mut mt-2 text-[12px]">* fête religieuse à confirmer selon le calendrier lunaire.</p>
        </div>
        <div className="card">
          <h2 className="mb-3">Mes soldes</h2>
          {bal.map((b) => (
            <div key={b.label} className="flex items-center gap-2 border-b border-line py-2 last:border-0">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
              <span>{b.label}</span>
              <b className="ml-auto">{num(b.solde, 1)} j</b>
            </div>
          ))}
          <p className="mut mt-3 text-[12.5px]">Congé annuel : 1,5 jour ouvrable acquis par mois travaillé.</p>
        </div>
      </div>
    </Guard>
  );
}
