"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dfr, fullName, monthLabel } from "@/lib/format";

type Line = { id: number; sort: number; code: string; label: string; base: number | null; rate: number | null; gain: number | null; retenue: number | null; employer: number | null };

/** Détail calculé par compute_payslip (payslips.meta). */
export type SlipMeta = {
  working_days?: number; objective?: number | null;
  rdv_brute?: number | null; rdv_qualif?: number | null; rdv_qualif_counted?: number | null; rdv_counted?: number | null; ratio?: number | null;
  step_label?: string | null; rdv_ok?: number;
  days_worked?: number; late_minutes?: number; absence_justified?: number; absence_unjustified?: number;
  leave_taken?: number; leave_balance?: number;
  salary?: number; assiduite?: number; challenge?: number; prime?: number;
  cnss_mode?: string; cnss_base?: number; amo_base?: number; employee_share?: number;
  challenge_paid?: number; advances?: number; advances_count?: number; other_deductions?: number;
  reste_a_prendre?: number; virement?: number; especes?: number; transfer_ref?: string;
};

export type Slip = {
  id: string; period_id: string; profile_id: string; base_salary: number; gross: number; cnss_employee: number; amo_employee: number;
  frais_pro: number; net_imposable: number; ir: number; deductions: number; net_pay: number; employer_charges: number; employer_cost: number;
  /** 'fixe' (staff, salaire de base) ou 'rdv' (agents brute / qualif). */
  pay_mode?: string | null;
  /** Ordre d'affichage calculé en base : staff d'abord, puis agents du net le plus haut au plus bas. */
  sort_rank?: number | null;
  meta?: SlipMeta | null;
};

const CNSS_LABEL: Record<string, string> = {
  plafonne: "Déclaré · plafonné", declare: "Déclaré", offert: "Déclaré · offert", tahfiz: "Tahfiz", non_declare: "Non déclaré",
};

/** Montant au format du bulletin : 7 300,00 */
const m = (n: number | null | undefined) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0)).replace(/ | /g, " ");
const q = (n: number | null | undefined) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(n ?? 0)).replace(/ | /g, " ");
const pct = (r: number | null | undefined) => (r == null ? "" : q(Number(r) * 100) + " %");

function monthsBetween(from: string | null | undefined, to: string) {
  if (!from) return null;
  const a = new Date(from + "T12:00:00"), b = new Date(to + "T12:00:00");
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()));
}

function Box({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      {title && <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-mut">{title}</div>}
      {children}
    </div>
  );
}
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line p-3.5 ${className}`}>{children}</div>;
}
function Row({ k, v, strong = false, mono = true }: { k: React.ReactNode; v: React.ReactNode; strong?: boolean; mono?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0 ${strong ? "font-semibold" : ""}`}>
      <span>{k}</span><span className={mono ? "font-mono tabular-nums" : ""}>{v}</span>
    </div>
  );
}
function Stat({ label, value, hi = false, text = false }: { label: string; value: React.ReactNode; hi?: boolean; text?: boolean }) {
  return (
    <div className={`p-3 ${hi ? "bg-gray2-l" : ""}`}>
      <div className="text-[12px] text-mut">{label}</div>
      <div className={`mt-1 font-semibold ${text ? "text-[15px] leading-7" : "font-mono text-[20px] tabular-nums"} ${hi ? "text-[#0f766e]" : ""}`}>{value}</div>
    </div>
  );
}
function Strip({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 divide-line overflow-hidden rounded-lg border border-line sm:grid-cols-4 sm:divide-x">{children}</div>;
}

/** Bulletin de paie (design A4 « Bulletin — NotionCall »). */
export function PayslipView({ slip, month }: { slip: Slip; month: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [p, setP] = useState<{ first_name: string; last_name: string; matricule: string | null; job_title: string | null; cin: string | null; hire_date: string | null; role_key: string | null } | null>(null);
  const [comp, setComp] = useState<{ cnss_number: string | null; rib: string | null } | null>(null);
  const [co, setCo] = useState<{ name: string; city: string | null; cnss_employer_no: string | null } | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("payslip_lines").select("*").eq("payslip_id", slip.id).order("sort").then(({ data }) => setLines((data as Line[]) ?? []));
    supabase.from("profiles").select("first_name,last_name,matricule,job_title,cin,hire_date,role_key").eq("id", slip.profile_id).maybeSingle()
      .then(({ data }) => {
        setP(data);
        if (data?.role_key) supabase.from("app_roles").select("label").eq("key", data.role_key).maybeSingle().then(({ data: r }) => setRole(r?.label ?? null));
      });
    supabase.from("employee_compensation").select("cnss_number,rib").eq("profile_id", slip.profile_id).maybeSingle().then(({ data }) => setComp(data));
    supabase.from("companies").select("name,city,cnss_employer_no").limit(1).maybeSingle().then(({ data }) => setCo(data));
  }, [slip]);

  const meta: SlipMeta = slip.meta ?? {};
  const isAgent = slip.pay_mode === "rdv";
  const line = (code: string) => lines.filter((l) => l.code === code);
  const sumGain = (code: string) => line(code).reduce((a, l) => a + Number(l.gain ?? 0), 0);

  // Montants : depuis meta (nouveau calcul) ; à défaut, reconstitués depuis les lignes (anciens bulletins)
  const hasMeta = meta.reste_a_prendre != null;
  const salary = hasMeta ? Number(meta.salary ?? 0) : sumGain("BASE") + sumGain("RDV") + sumGain("JOURS");
  const assid = hasMeta ? Number(meta.assiduite ?? 0) : sumGain("ASSIDUITE");
  const chal = hasMeta ? Number(meta.challenge ?? 0) : isAgent ? sumGain("CHALLENGE") : 0;
  const gross = Number(slip.gross);
  const prime = Math.max(0, Math.round((gross - salary - assid - chal) * 100) / 100);
  const share = Number(slip.cnss_employee) + Number(slip.amo_employee) + Number(slip.ir);
  const chalPaid = hasMeta ? Number(meta.challenge_paid ?? 0) : 0;
  const adv = hasMeta ? Number(meta.advances ?? 0) : 0;
  const otherDed = Number(slip.deductions) - adv;
  const reste = hasMeta ? Number(meta.reste_a_prendre) : Number(slip.net_pay);
  const especes = hasMeta ? Number(meta.especes ?? 0) : 0;
  const cnssLine = line("CNSS")[0], amoLine = line("AMO")[0];
  const wd = meta.working_days;
  const lastDay = new Date(new Date(month + "T12:00:00").getFullYear(), new Date(month + "T12:00:00").getMonth() + 1, 0);
  const seniority = monthsBetween(p?.hire_date, month);
  const absence = (meta.absence_justified ?? 0) + (meta.absence_unjustified ?? 0) === 0 ? "Aucune"
    : [meta.absence_justified ? `${q(meta.absence_justified)} j justifiée${(meta.absence_justified ?? 0) > 1 ? "s" : ""}` : null,
       meta.absence_unjustified ? `${q(meta.absence_unjustified)} j injustifiée${(meta.absence_unjustified ?? 0) > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-[820px] text-[13px] text-[#0f172a]">
      {/* En-tête */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b-2 border-[#0f172a] pb-3">
        <div>
          <div className="text-[20px] font-bold">{co?.name ?? "NotionCall"}</div>
          <div className="text-mut">{co?.city ?? "Marrakech"}{co?.cnss_employer_no ? ` · CNSS n° ${co.cnss_employer_no}` : ""}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-mut">Bulletin de paie</div>
          <div className="text-[22px] font-bold capitalize">{monthLabel(month)}</div>
        </div>
      </div>

      {/* Salarié · RIB · Période */}
      <div className="mb-5 grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
        <Card>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-mut">Salarié</div>
          <div className="mb-1.5 text-[16px] font-bold">{fullName(p)}</div>
          <div className="grid grid-cols-[64px_1fr] gap-y-0.5">
            <span className="text-mut">CIN</span><span className="font-mono">{p?.cin || "—"}</span>
            <span className="text-mut">CNSS</span><span className="font-mono">{comp?.cnss_number || "—"}</span>
            <span className="text-mut">Rôle</span><span>{isAgent ? `Agent · ${role?.replace(/^Agent\s+/i, "") ?? ""}` : role ?? p?.job_title ?? "—"}</span>
            <span className="text-mut">Entrée</span><span>{p?.hire_date ? `${dfr(p.hire_date)} · ${seniority} mois` : "—"}</span>
          </div>
        </Card>
        <Card>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-mut">RIB</div>
          <div className="break-all font-mono">{comp?.rib || "—"}</div>
        </Card>
        <Card>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-mut">Période</div>
          <div className="grid grid-cols-[1fr_auto] gap-y-0.5">
            <span className="text-mut">Date</span><span>{lastDay.toLocaleDateString("fr-FR")}</span>
            <span className="text-mut">Salaire du mois</span><span className="capitalize">{new Date(month + "T12:00:00").toLocaleDateString("fr-FR", { month: "long" })}</span>
            <span className="text-mut">Jours ouvrables</span><b>{wd ?? "—"}</b>
            {isAgent && <><span className="text-mut">Objectif RDV</span><b>{meta.objective ?? "—"}</b></>}
          </div>
        </Card>
      </div>

      {/* Production */}
      {isAgent ? (
        <Box title="Production" className="mb-5">
          <Strip>
            <Stat label="RDV brute" value={q(meta.rdv_brute)} />
            <Stat label="RDV qualif (÷2)" value={<>{q(meta.rdv_qualif)} <span className="text-mut">→</span> {q(meta.rdv_qualif_counted)}</>} />
            <Stat label="RDV comptés" value={q(meta.rdv_counted)} />
            <Stat label="Ratio / jour" value={q(meta.ratio)} hi />
          </Strip>
        </Box>
      ) : (meta.rdv_ok ?? 0) > 0 ? (
        <Box title="Production" className="mb-5">
          <Strip>
            <Stat label="RDV OK pris" value={q(meta.rdv_ok)} />
            <Stat label="Prime par RDV OK" value="150" />
            <Stat label="Prime RDV" value={m(sumGain("RDV_OK"))} hi />
            <Stat label="Jours ouvrables" value={wd ?? "—"} />
          </Strip>
        </Box>
      ) : null}

      {/* Présence */}
      <Box title="Présence" className="mb-5">
        <Strip>
          <Stat label="Jours travaillés" value={wd ? `${q(meta.days_worked)} / ${wd}` : "—"} />
          <Stat label="Retard cumulé" value={`${q(meta.late_minutes)} min`} />
          <Stat label="Absence" value={absence} text />
          <Stat label="Congés payés" value={`${q(meta.leave_taken)} pris · solde ${q(meta.leave_balance)} j`} text />
        </Strip>
      </Box>

      {/* Rémunération · CNSS */}
      <div className="mb-4 grid gap-4 sm:grid-cols-[1.15fr_1fr]">
        <Box title="Rémunération">
          <Card className="py-1.5">
            <Row k="Tranche salariale" v={<b>{isAgent ? meta.step_label ?? "—" : "Salaire fixe"}</b>} mono={false} />
            <Row k="Salaire" v={m(salary)} />
            {assid > 0 && <Row k="Prime d'assiduité" v={m(assid)} />}
            {isAgent && <Row k="Challenge" v={m(chal)} />}
            {prime > 0 && <Row k={<>Prime &amp; autres <span className="text-mut">{isAgent ? "(performance)" : (meta.rdv_ok ?? 0) > 0 ? "(RDV OK)" : ""}</span></>} v={m(prime)} />}
            <Row k="Salaire brut" v={m(gross)} strong />
          </Card>
        </Box>
        <Box title="CNSS">
          <Card className="py-1.5">
            <Row k="Statut" v={<b>{CNSS_LABEL[meta.cnss_mode ?? ""] ?? "Déclaré"}</b>} mono={false} />
            <Row k="Base soumise" v={m(meta.cnss_base ?? cnssLine?.base)} />
            <Row k={`CNSS ${pct(cnssLine?.rate)}`} v={`- ${m(slip.cnss_employee)}`} />
            <Row k={`AMO ${pct(amoLine?.rate)}`} v={`- ${m(slip.amo_employee)}`} />
            {Number(slip.ir) > 0 && <Row k="IR" v={`- ${m(slip.ir)}`} />}
            <Row k="Part salariale" v={`- ${m(share)}`} strong />
          </Card>
        </Box>
      </div>

      {/* Déductions */}
      {(chalPaid > 0 || adv > 0 || otherDed > 0) && (
        <Card className="mb-4 py-1.5">
          {chalPaid > 0 && <Row k={<>Challenges déjà versés <span className="text-mut">(espèces, le jour même)</span></>} v={`- ${m(chalPaid)}`} />}
          {adv > 0 && <Row k={<>Avances du mois <span className="text-mut">({meta.advances_count} versement{(meta.advances_count ?? 0) > 1 ? "s" : ""})</span></>} v={`- ${m(adv)}`} />}
          {otherDed > 0 && <Row k="Autres retenues" v={`- ${m(otherDed)}`} />}
        </Card>
      )}

      {/* Reste à prendre */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[#0f172a] px-5 py-4">
        <div>
          <div className="text-[17px] font-bold">Reste à prendre</div>
          <div className="text-[12px] text-mut">Brut − challenges versés − part salariale − avances</div>
        </div>
        <div className="font-mono text-[30px] font-bold tabular-nums text-[#0f766e]">{m(reste)} <span className="text-[15px] text-[#0f172a]">DH</span></div>
      </div>

      {/* Total perçu · Moyen de paiement */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Box title="Total perçu">
          <Card className="py-1.5">
            <Row k="Salaire" v={m(salary + assid)} />
            {isAgent && <Row k="Challenge" v={m(chal)} />}
            {prime > 0 && <Row k="Prime & autres" v={m(prime)} />}
            <Row k="Total" v={m(gross)} strong />
          </Card>
        </Box>
        <Box title="Moyen de paiement">
          <Card className="py-1.5">
            <Row k="Virement bancaire" v={m(hasMeta ? meta.virement : reste)} />
            {especes > 0 && <Row k="Espèces (challenges du mois)" v={m(especes)} />}
            <Row k="Ordre de virement" v={meta.transfer_ref ?? "—"} mono={false} />
            <Row k="Versé" v={m(Number(hasMeta ? meta.virement : reste) + especes)} strong />
          </Card>
        </Box>
      </div>
    </div>
  );
}
