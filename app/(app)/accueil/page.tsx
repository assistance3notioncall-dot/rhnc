"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Badge, Kpi, PageHead } from "@/components/ui";
import { dfr, dh, KIND, monthStart, num, ymd } from "@/lib/format";
import type { RequestRow } from "@/lib/types";

type Abs = { id: string; first_name: string; last_name: string; start_date: string; end_date: string; type_code: string; color: string };

export default function Accueil() {
  const { me, can } = useSession();
  const [solde, setSolde] = useState<number | null>(null);
  const [reqs, setReqs] = useState<RequestRow[]>([]);
  const [absToday, setAbsToday] = useState<Abs[]>([]);
  const [rdv, setRdv] = useState<{ rdv: number; challenge: number; rang: number } | null>(null);
  const [holiday, setHoliday] = useState<{ day: string; label: string } | null>(null);

  useEffect(() => {
    if (!me) return;
    const today = ymd(new Date());
    // Toutes les requêtes de l'accueil partent en même temps (au lieu de l'une après l'autre)
    (async () => {
      const [ltRes, rRes, aRes, hRes, sRes] = await Promise.all([
        supabase.from("leave_types").select("id").eq("code", "CONGE_ANNUEL").maybeSingle(),
        supabase.from("requests").select("*").eq("profile_id", me.id).order("created_at", { ascending: false }).limit(5),
        supabase.from("team_absences").select("*").lte("start_date", today).gte("end_date", today),
        supabase.from("holidays").select("day,label").gte("day", today).order("day").limit(1).maybeSingle(),
        can("mesrdv")
          ? supabase.from("stats_agent_month").select("rdv,challenge,rang").eq("profile_id", me.id).eq("month", monthStart()).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setReqs((rRes.data as RequestRow[]) ?? []);
      setAbsToday((aRes.data as Abs[]) ?? []);
      setHoliday(hRes.data);
      setRdv(sRes.data as { rdv: number; challenge: number; rang: number } | null);
      if (ltRes.data) {
        const { data } = await supabase.rpc("balance_of", { p_profile: me.id, p_leave_type: ltRes.data.id });
        setSolde(Number(data ?? 0));
      }
    })();
  }, [me, can]);

  const enCours = reqs.filter((r) => ["envoyee", "valid_mgr", "valid_rh"].includes(r.status)).length;

  return (
    <Guard module="accueil">
      <PageHead title={`Bonjour ${me?.first_name ?? ""} 👋`} sub="Voici l'essentiel de votre espace RH.">
        {can("demandes") && <Link href="/demandes?new=absence" className="btn-pri">+ Demander un congé</Link>}
      </PageHead>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Solde congé annuel" value={solde == null ? "—" : `${num(solde, 1)} j`} hint="+1,5 j acquis par mois" tone="text-pri-d" />
        <Kpi label="Demandes en cours" value={enCours} hint="en attente de validation" />
        {rdv ? (
          <Kpi label="RDV ce mois" value={rdv.rdv} hint={`Challenge ${dh(rdv.challenge)} · rang ${rdv.rang}`} tone="text-ok" />
        ) : (
          <Kpi label="Absents aujourd'hui" value={absToday.length} hint="dans votre équipe" />
        )}
        <Kpi label="Prochain jour férié" value={holiday ? dfr(holiday.day) : "—"} hint={holiday?.label} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card">
          <div className="mb-3 flex items-center justify-between"><h2>Mes dernières demandes</h2><Link className="text-pri" href="/demandes">Tout voir →</Link></div>
          {reqs.length === 0 ? <p className="mut">Aucune demande pour l&apos;instant.</p> : (
            <div className="overflow-x-auto"><table className="tbl"><tbody>
              {reqs.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.ref ?? "Brouillon"}</td>
                  <td>{KIND[r.kind]}</td>
                  <td className="mut">{r.start_date ? `${dfr(r.start_date)} → ${dfr(r.end_date)}` : dfr(r.created_at)}</td>
                  <td><Badge status={r.status} /></td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </div>
        <div className="card">
          <h2 className="mb-3">Absents aujourd&apos;hui</h2>
          {absToday.length === 0 ? <p className="mut">Toute l&apos;équipe est là.</p> : absToday.map((a) => (
            <div key={a.id} className="flex items-center gap-2 border-b border-line py-2 last:border-0">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
              <span className="font-medium">{a.first_name} {a.last_name}</span>
              <span className="mut ml-auto text-[12.5px]">jusqu&apos;au {dfr(a.end_date)}</span>
            </div>
          ))}
        </div>
      </div>
    </Guard>
  );
}
