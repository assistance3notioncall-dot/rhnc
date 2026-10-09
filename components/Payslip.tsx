"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dh, fullName, monthLabel, num } from "@/lib/format";

type Line = { id: number; sort: number; code: string; label: string; base: number | null; rate: number | null; gain: number | null; retenue: number | null; employer: number | null };
export type Slip = {
  id: string; period_id: string; profile_id: string; base_salary: number; gross: number; cnss_employee: number; amo_employee: number;
  frais_pro: number; net_imposable: number; ir: number; deductions: number; net_pay: number; employer_charges: number; employer_cost: number;
};

/** Bulletin de paie imprimable. */
export function PayslipView({ slip, month }: { slip: Slip; month: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [p, setP] = useState<{ first_name: string; last_name: string; matricule: string | null; job_title: string | null; cin: string | null; hire_date: string | null } | null>(null);
  useEffect(() => {
    supabase.from("payslip_lines").select("*").eq("payslip_id", slip.id).order("sort").then(({ data }) => setLines((data as Line[]) ?? []));
    supabase.from("profiles").select("first_name,last_name,matricule,job_title,cin,hire_date").eq("id", slip.profile_id).maybeSingle().then(({ data }) => setP(data));
  }, [slip]);
  return (
    <div className="text-[13px]">
      <div className="mb-4 flex flex-wrap justify-between gap-3 border-b border-line pb-3">
        <div><div className="text-base font-bold">NotionCall SARL</div><div className="mut">Marrakech</div></div>
        <div className="text-right">
          <div className="font-bold">BULLETIN DE PAIE</div>
          <div className="capitalize">{monthLabel(month)}</div>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div><span className="mut">Salarié :</span> <b>{fullName(p)}</b></div>
        <div><span className="mut">Matricule :</span> {p?.matricule ?? "—"}</div>
        <div><span className="mut">Poste :</span> {p?.job_title ?? "—"}</div>
        <div><span className="mut">CIN :</span> {p?.cin ?? "—"}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Rubrique</th><th className="text-right">Base</th><th className="text-right">Taux</th><th className="text-right">Gain</th><th className="text-right">Retenue</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.label}</td>
                <td className="text-right">{l.base != null ? num(l.base, 2) : ""}</td>
                <td className="text-right">{l.rate != null ? (l.rate < 1 ? num(l.rate * 100, 2) + " %" : num(l.rate, 2)) : ""}</td>
                <td className="text-right">{l.gain != null ? num(l.gain, 2) : ""}</td>
                <td className="text-right">{l.retenue != null ? num(l.retenue, 2) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-gray2-l p-2.5"><div className="mut text-[12px]">Brut</div><b>{dh(slip.gross)}</b></div>
        <div className="rounded-lg bg-gray2-l p-2.5"><div className="mut text-[12px]">Net imposable</div><b>{dh(slip.net_imposable)}</b></div>
        <div className="rounded-lg bg-gray2-l p-2.5"><div className="mut text-[12px]">IR</div><b>{dh(slip.ir)}</b></div>
        <div className="rounded-lg bg-pri-l p-2.5 text-pri-d"><div className="text-[12px]">Net à payer</div><b className="text-base">{dh(slip.net_pay)}</b></div>
      </div>
    </div>
  );
}
