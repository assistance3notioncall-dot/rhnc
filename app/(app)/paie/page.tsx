"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Badge, Empty, Field, Kpi, Modal, PageHead, Tabs, useAction } from "@/components/ui";
import { PayslipView, type Slip } from "@/components/Payslip";
import { dh, downloadCSV, fullName, monthLabel, monthStart, num } from "@/lib/format";
import { printHtml } from "@/lib/print";

type Period = { id: string; month: string; status: string; computed_at: string | null; validated_at: string | null; working_days: number | null };
type Person = { id: string; first_name: string; last_name: string; matricule: string | null; groupe: string | null };
// Même regroupement que la page Salariés (profiles.groupe)
const GROUPS: [string, string][] = [["direction", "Direction"], ["back_office", "Back office"], ["agents", "Agents"], ["extra", "Entretien & logistique"]];
const groupRank = (g?: string | null) => { const i = GROUPS.findIndex(([k]) => k === g); return i < 0 ? GROUPS.length : i; };
const groupLabel = (g?: string | null) => GROUPS.find(([k]) => k === g)?.[1] ?? "Sans groupe";

// Colonnes du tableau de paie, alignées sur la feuille PayrollNC :
// Salaire + Assiduité = T.Salaire ; T.Salaire + Challenge = T.Brute ; T.Net = T.Brute − P.Sal ;
// Reste à prendre = T.Salaire − Avance − P.Sal ; T.Cost = T.Brute + P.Pat
const n0 = (v: unknown) => Number(v ?? 0) || 0;
const assidOf = (s: Slip) => n0(s.meta?.assiduite);
const chalOf = (s: Slip) => s.pay_mode === "rdv" ? n0(s.meta?.challenge) : 0;
const psalOf = (s: Slip) => n0(s.cnss_employee) + n0(s.amo_employee) + n0(s.ir);
type Col = { key: string; label: string; hint?: string; get: (s: Slip) => number; band?: string; strong?: boolean; tone?: string; total?: boolean };
const COLS: Col[] = [
  { key: "rdv", label: "RDV", hint: "RDV comptés (qualif ÷ 2)", get: (s) => n0(s.meta?.rdv_counted), total: true },
  { key: "sal", label: "Salaire", hint: "Salaire de base / palier, primes comprises", get: (s) => n0(s.gross) - assidOf(s) - chalOf(s) },
  { key: "assid", label: "Assiduité", get: assidOf },
  { key: "tsal", label: "T.Salaire", hint: "Salaire + assiduité", get: (s) => n0(s.gross) - chalOf(s), strong: true, band: "bg-[#f8fafc]" },
  { key: "chal", label: "Challenge", hint: "Versé en espèces pendant le mois", get: chalOf },
  { key: "brut", label: "T.Brute", hint: "T.Salaire + challenge", get: (s) => n0(s.gross) },
  { key: "adv", label: "Avance", get: (s) => n0(s.meta?.advances), tone: "text-[#b45309]" },
  { key: "decl", label: "Déclaré CNSS", hint: "Salaire déclaré (soumis à cotisation)", get: (s) => n0(s.meta?.cnss_base), band: "bg-[#f0f9ff]" },
  { key: "psal", label: "P.Sal", hint: "Part salariale : 6,4 % du salaire déclaré", get: psalOf, band: "bg-[#f0f9ff]" },
  { key: "ppat", label: "P.Pat", hint: "Part patronale : 16 % du salaire déclaré", get: (s) => n0(s.employer_charges), band: "bg-[#f0f9ff]" },
  { key: "tnet", label: "T.Net", hint: "T.Brute − P.Sal", get: (s) => n0(s.gross) - psalOf(s) },
  { key: "reste", label: "Reste à prendre", hint: "T.Salaire − avance − P.Sal", get: (s) => n0(s.meta?.reste_a_prendre ?? s.net_pay), strong: true, tone: "text-[#0f766e]", band: "bg-[#f0fdf4]" },
  { key: "cost", label: "T.Cost", hint: "Coût total pour NotionCall : T.Brute + P.Pat", get: (s) => n0(s.employer_cost) },
];
const CNSS_SHORT: Record<string, string> = { plafonne: "CNSS plafonnée", declare: "CNSS déclarée", offert: "CNSS offerte", tahfiz: "Tahfiz", non_declare: "Non déclaré" };
type Input = { id: number; profile_id: string; code: string; label: string; kind: string; quantity: number | null; amount: number | null; cotisable: boolean; imposable: boolean };

const PRESETS: Record<string, { label: string; kind: string; qty?: boolean; flag?: boolean; cotisable?: boolean; imposable?: boolean }> = {
  HS25: { label: "Heures sup. +25 %", kind: "gain", qty: true },
  HS50: { label: "Heures sup. +50 %", kind: "gain", qty: true },
  HS100: { label: "Heures sup. +100 %", kind: "gain", qty: true },
  ABS_NP: { label: "Absence non payée (jours)", kind: "gain", qty: true },
  JOURS_TRAV: { label: "Jours travaillés (agents)", kind: "info", qty: true },
  PRIME_QUALITE: { label: "Prime qualité (montant fixé, confirmés)", kind: "info" },
  SANS_DEPASSEMENT: { label: "Pas de prime de dépassement ce mois-ci (agents)", kind: "info", flag: true },
  PRIME_BIENVENUE: { label: "Prime de bienvenue", kind: "gain" },
  PRIME: { label: "Prime & autres (performance)", kind: "gain" },
  AVANCE: { label: "Avance sur salaire", kind: "retenue", cotisable: false, imposable: false },
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
  const [newDays, setNewDays] = useState("");
  const [days, setDays] = useState("");
  const [fGroup, setFGroup] = useState("tous");
  const [printAll, setPrintAll] = useState(false);
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
      supabase.from("payslips").select("*").eq("period_id", cur.id).order("sort_rank", { nullsFirst: false }),
      supabase.from("payroll_inputs").select("*").eq("period_id", cur.id).order("id"),
    ]);
    setSlips((s as Slip[]) ?? []); setInputs((i as Input[]) ?? []);
  }, [cur]);
  useEffect(() => { loadPeriods(); supabase.from("profiles").select("id,first_name,last_name,matricule,groupe").order("first_name").then(({ data }) => setPeople((data as Person[]) ?? [])); }, [loadPeriods]);
  useEffect(() => { loadPeriod(); }, [loadPeriod]);
  // Temps réel : chaque recalcul automatique en base (RDV, salaire, avance, absence…) met à jour payroll_periods.computed_at
  useEffect(() => {
    if (!cur) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(t); t = setTimeout(() => { loadPeriod(); }, 400); };
    const ch = supabase.channel(`paie-${cur.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "payroll_periods", filter: `id=eq.${cur.id}` }, refresh)
      .subscribe();
    const onFocus = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    const poll = setInterval(onFocus, 30000);
    return () => { clearTimeout(t); clearInterval(poll); supabase.removeChannel(ch); document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
  }, [cur, loadPeriod]);
  // Le bulletin ouvert suit le dernier calcul (un recalcul crée un nouveau bulletin pour le même salarié)
  const liveView = view ? slips.find((x) => x.profile_id === view.profile_id) ?? view : null;
  useEffect(() => { setDays(cur?.working_days != null ? String(cur.working_days) : ""); }, [cur]);

  const name = (id: string) => fullName(people.find((p) => p.id === id));
  const open = cur && ["ouverte", "calculee"].includes(cur.status);
  const sum = (k: keyof Slip) => slips.reduce((a, s) => a + Number(s[k] ?? 0), 0);
  // Staff (salaire fixe) d'abord, puis agents RDV du net le plus haut au plus bas — même ordre que sort_rank en base.
  const grp = (id: string) => people.find((p) => p.id === id)?.groupe ?? null;
  const ordered = [...slips].filter((s) => fGroup === "tous" || grp(s.profile_id) === fGroup).sort((a, b) =>
    groupRank(grp(a.profile_id)) - groupRank(grp(b.profile_id))
    || (a.sort_rank ?? Infinity) - (b.sort_rank ?? Infinity)
    || Number(a.pay_mode === "rdv") - Number(b.pay_mode === "rdv")
    || Number(b.net_pay) - Number(a.net_pay)
    || name(a.profile_id).localeCompare(name(b.profile_id)));
  const metaSum = (k: "reste_a_prendre" | "especes" | "advances" | "virement") => slips.reduce((a, s) => a + Number(s.meta?.[k] ?? 0), 0);
  const autoDays = slips.find((s) => s.meta?.working_days != null)?.meta?.working_days;
  const method = (s: Slip) => s.pay_method ?? s.meta?.pay_method ?? "virement";
  const canPayMethod = canEdit && cur?.status !== "cloturee";
  const setMethod = (s: Slip, m: string) => run(async () => {
    must(await supabase.rpc("set_payslip_pay_method", { p_slip: s.id, p_method: m }));
    await loadPeriod();
  }, m === "virement" ? "Payé par virement" : "Payé en espèces");

  // Virement de masse : tous les bulletins « Virement » d'une période validée.
  type TransferRow = { profile_id: string; full_name: string; cin: string | null; rib: string; rib_ok: boolean; amount: number; ref: string };
  const massTransfer = () => run(async () => {
    if (!cur) return;
    const rows = (must(await supabase.rpc("mass_transfer_rows", { p_period: cur.id })) as TransferRow[]) ?? [];
    if (!rows.length) throw new Error("Aucun salarié à payer par virement sur cette période.");
    const bad = rows.filter((r) => !r.rib_ok);
    if (bad.length && !confirm(`${bad.length} RIB invalide(s) : ${bad.map((r) => r.full_name).join(", ")}.\nLes inclure quand même (à corriger avant envoi à la banque) ?`)) return;
    const total = rows.reduce((a, r) => a + Number(r.amount), 0);
    downloadCSV(`virement-masse-${cur.month.slice(0, 7)}.csv`, rows.map((r, i) => ({
      n: i + 1, beneficiaire: r.full_name, cin: r.cin ?? "", rib: r.rib, montant: Number(r.amount).toFixed(2), motif: r.ref, rib_valide: r.rib_ok ? "oui" : "NON",
    })));
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
    printHtml(`Virement de masse — ${monthLabel(cur.month)}`, `
      <h2 style="margin:0 0 4px">Ordre de virement de masse — ${esc(monthLabel(cur.month))}</h2>
      <p style="margin:0 0 12px;color:#555">${rows.length} bénéficiaire(s) · Total ${esc(dh(total))}</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>${["N°", "Bénéficiaire", "CIN", "RIB", "Montant (DH)", "Motif"].map((h) => `<th style="text-align:left;border-bottom:1px solid #999;padding:4px">${h}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr${r.rib_ok ? "" : ' style="background:#fee2e2"'}><td style="padding:4px">${i + 1}</td><td style="padding:4px">${esc(r.full_name)}</td><td style="padding:4px">${esc(r.cin ?? "")}</td><td style="padding:4px;font-family:monospace">${esc(r.rib)}</td><td style="padding:4px;text-align:right">${Number(r.amount).toFixed(2)}</td><td style="padding:4px">${esc(r.ref)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="4" style="padding:6px 4px;border-top:1px solid #999;font-weight:bold">Total</td><td style="padding:6px 4px;border-top:1px solid #999;text-align:right;font-weight:bold">${total.toFixed(2)}</td><td style="border-top:1px solid #999"></td></tr></tfoot>
      </table>
      <p style="margin-top:40px">Signature et cachet :</p>`);
  }, "Fichier de virement généré");

  return (
    <Guard module="paie">
      <PageHead title="Paie" sub="Agents : palier selon RDV / jour ouvrable + assiduité + challenge · Staff : salaire de base + 150 DH par RDV OK — CNSS selon le mode de chaque salarié.">
        <select className="inp w-auto" value={cur?.id ?? ""} onChange={(e) => setCur(periods.find((p) => p.id === e.target.value) ?? null)}>
          {periods.length === 0 && <option value="">Aucune période</option>}
          {periods.map((p) => <option key={p.id} value={p.id}>{monthLabel(p.month)}</option>)}
        </select>
        {canEdit && (<>
          <input type="month" className="inp w-auto" value={newMonth} onChange={(e) => setNewMonth(e.target.value)} />
          <input type="number" min={1} max={31} className="inp w-28" placeholder="Jours ouvr." title="Jours ouvrables du mois (vide = lundi→vendredi hors fériés)"
            value={newDays} onChange={(e) => setNewDays(e.target.value)} />
          <button className="btn" disabled={busy} onClick={() => run(async () => {
            must(await supabase.from("payroll_periods").insert({ company_id: me!.company_id, month: newMonth + "-01", working_days: newDays ? Number(newDays) : null }));
            setNewDays(""); await loadPeriods();
          }, "Période ouverte")}>Ouvrir le mois</button>
        </>)}
      </PageHead>
      {!cur ? <div className="card"><Empty>Ouvrez un mois de paie pour commencer.</Empty></div> : (<>
        <div className="card mb-4 flex flex-wrap items-center gap-3">
          <h2 className="capitalize">{monthLabel(cur.month)}</h2><Badge status={cur.status} />
          <label className="flex items-center gap-2 text-[13px]">
            <span className="mut">Jours ouvrables</span>
            {canEdit && open ? (<>
              <input type="number" min={1} max={31} className="inp w-20 py-1.5" placeholder={autoDays != null ? String(autoDays) : "auto"}
                value={days} onChange={(e) => setDays(e.target.value)} />
              {(days || null) !== (cur.working_days != null ? String(cur.working_days) : null) && (
                <button className="btn btn-sm" disabled={busy} onClick={() => run(async () => {
                  must(await supabase.from("payroll_periods").update({ working_days: days ? Number(days) : null }).eq("id", cur.id));
                  await loadPeriods();
                }, "Jours ouvrables enregistrés — recalculez la paie")}>Enregistrer</button>)}
            </>) : <b>{cur.working_days ?? autoDays ?? "—"}</b>}
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            {canEdit && open && <button className="btn-pri" disabled={busy} onClick={() => run(async () => {
              const n = must(await supabase.rpc("compute_payroll", { p_period: cur.id })); await loadPeriods(); await loadPeriod(); return n;
            }, "Paie calculée (absences, retards, challenge et HS inclus)")}>{cur.status === "calculee" ? "Recalculer" : "Calculer la paie"}</button>}
            {canEdit && cur.status === "calculee" && <button className="btn-ok" disabled={busy} onClick={() => confirm("Valider ? Les bulletins seront publiés aux salariés et le mois sera verrouillé.") && run(async () => {
              must(await supabase.rpc("validate_payroll", { p_period: cur.id })); await loadPeriods();
            }, "Paie validée — bulletins publiés")}>Valider & publier</button>}
            <button className="btn" disabled={!slips.length} onClick={() => downloadCSV(`paie-${cur.month}.csv`, ordered.map((s) => ({
              groupe: groupLabel(grp(s.profile_id)), matricule: people.find((p) => p.id === s.profile_id)?.matricule, salarie: name(s.profile_id),
              tranche: s.pay_mode === "rdv" ? s.meta?.step_label ?? "" : "Salaire fixe", cnss: CNSS_SHORT[s.meta?.cnss_mode ?? ""] ?? "",
              ...Object.fromEntries(COLS.map((c) => [c.label, c.get(s).toFixed(2)])), paiement: method(s),
})))}>Journal de paie (CSV)</button>
            {canEdit && ["validee", "cloturee"].includes(cur.status) && <button className="btn" disabled={busy || !slips.length} onClick={massTransfer}>Virement de masse</button>}
            <button className="btn" disabled={!ordered.length} title="Tous les bulletins affichés (groupe sélectionné) dans un seul PDF, un bulletin par page"
              onClick={() => setPrintAll(true)}>Télécharger tous les bulletins ({ordered.length})</button>
          </div>
        </div>
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Masse salariale brute" value={dh(sum("gross"))} />
          <Kpi label="Virements" value={dh(metaSum("virement"))} tone="text-pri-d" hint={`${slips.filter((s) => method(s) === "virement").length} salarié(s) · reste à prendre ${dh(metaSum("reste_a_prendre"))}`} />
          <Kpi label="Espèces" value={dh(metaSum("especes"))} hint={`Challenges + reste en espèces · avances : ${dh(metaSum("advances"))}`} />
          <Kpi label="Coût total employeur" value={dh(sum("employer_cost"))} hint={`${slips.length} bulletin(s)`} />
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: "bulletins", label: "Bulletins" }, { key: "variables", label: `Éléments variables (${inputs.length})` }]} />
        {tab === "bulletins" && slips.length > 0 && (
          <div className="mb-3"><Tabs value={fGroup} onChange={setFGroup} tabs={[{ key: "tous", label: `Tous (${slips.length})` },
            ...GROUPS.map(([k, l]) => ({ key: k, label: `${l} (${slips.filter((s) => grp(s.profile_id) === k).length})` }))
              .filter((t) => !t.label.endsWith("(0)"))]} /></div>)}
        <div className="card max-h-[calc(100vh-9rem)] overflow-auto p-0">
          {tab === "bulletins" ? (slips.length === 0 ? <Empty>Cliquez sur « Calculer la paie ».</Empty> : (
            <table className="tbl text-[13px] [&_td]:whitespace-nowrap [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:shadow-[inset_0_-1px_0_#e5e7eb]">
              <thead>
                <tr className="[&_th]:text-[11px]">
                  <th className="sticky left-0 z-20 bg-[#fafbfd]">Salarié</th>
                  {COLS.map((c) => <th key={c.key} className={`text-right ${c.band ?? ""}`} title={c.hint}>{c.label}</th>)}
                  <th>Paiement</th><th />
                </tr>
              </thead>
              <tbody>{ordered.map((s, i) => {
                const g = grp(s.profile_id);
                const head = i === 0 || grp(ordered[i - 1].profile_id) !== g;
                const inG = ordered.filter((x) => grp(x.profile_id) === g);
                return (<Fragment key={s.id}>
                {head && (
                  <tr className="bg-gray2-l text-[12px]">
                    <td className="sticky left-0 z-[1] bg-gray2-l py-1.5 font-bold uppercase tracking-wide text-pri-d">{groupLabel(g)} <span className="mut font-normal normal-case">· {inG.length}</span></td>
                    {COLS.map((c) => <td key={c.key} className={`text-right font-semibold ${c.band ?? ""}`}>{c.total === false ? "" : num(inG.reduce((a, x) => a + c.get(x), 0), 0)}</td>)}
                    <td colSpan={2} />
                  </tr>)}
                <tr>
                  <td className="sticky left-0 z-[1] bg-white">
                    <div className="font-medium">{name(s.profile_id)}{s.meta?.exit_date && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800" title={`Prorata : ${s.meta.days_present} j / ${s.meta.working_days} j`}>sorti le {new Date(s.meta.exit_date).toLocaleDateString("fr-FR")}</span>}</div>
                    <div className="mut text-[11.5px]">{s.pay_mode === "rdv"
                      ? <>{s.meta?.step_label ?? "—"}{s.meta?.ratio != null && <> · {num(s.meta.ratio, 2)}/j</>}</>
                      : (s.meta?.conf_total ?? 0) > 0 ? `Confirmé · qualité ${num(s.meta?.conf_rate ?? 0, 1)} %` : (s.meta?.sup_prime ?? 0) > 0 ? "Chef d'équipe qualif" : "Salaire fixe"}
                      {" · "}{CNSS_SHORT[s.meta?.cnss_mode ?? ""] ?? "CNSS"}</div>
                  </td>
                  {COLS.map((c) => { const v = c.get(s); return (
                    <td key={c.key} className={`text-right tabular-nums ${c.band ?? ""} ${c.strong ? "font-semibold" : ""} ${v === 0 ? "text-mut" : ""} ${c.tone ?? ""}`}>{v === 0 ? "—" : num(v, 2)}</td>); })}
                  <td>
                    <label className={"flex items-center gap-1.5 text-[12.5px]" + (canPayMethod ? " cursor-pointer" : "")} title="Coché = virement bancaire, décoché = espèces">
                      <input type="checkbox" disabled={!canPayMethod || busy} checked={method(s) === "virement"}
                        onChange={(e) => setMethod(s, e.target.checked ? "virement" : "especes")} />
                      {method(s) === "virement" ? "Virement" : "Espèces"}
                      {method(s) === "virement" && s.meta?.rib_ok === false && <span className="text-red-600" title="RIB manquant ou invalide">⚠ RIB</span>}
                    </label>
                  </td>
                  <td className="text-right"><button className="btn btn-sm" onClick={() => setView(s)}>Bulletin</button></td>
                </tr></Fragment>);
              })}
              <tr className="border-t-2 border-[#0f172a] bg-[#f1f5f9] text-[12.5px]">
                <td className="sticky left-0 z-[1] bg-[#f1f5f9] font-bold">Total {fGroup === "tous" ? "général" : groupLabel(fGroup)} <span className="mut font-normal">· {ordered.length}</span></td>
                {COLS.map((c) => <td key={c.key} className={`text-right font-bold tabular-nums ${c.band ?? ""}`}>{c.total === false ? "" : num(ordered.reduce((a, x) => a + c.get(x), 0), 0)}</td>)}
                <td colSpan={2} />
              </tr>
              </tbody>
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
          <div id="slip"><PayslipView slip={liveView ?? view} month={cur.month} /></div>
          <div className="mt-3 flex justify-end"><button className="btn-pri" onClick={() => printHtml("Bulletin", document.getElementById("slip")?.innerHTML ?? "")}>Imprimer / PDF</button></div>
        </Modal>
      )}
      {printAll && cur && <AllSlips slips={ordered} month={cur.month} title={`Bulletins ${monthLabel(cur.month)}${fGroup === "tous" ? "" : " — " + groupLabel(fGroup)}`} onClose={() => setPrintAll(false)} />}
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
      {p.flag ? null : p.qty ? <Field label={code === "ABS_NP" || code === "JOURS_TRAV" ? "Nombre de jours" : "Nombre d'heures"}><input type="number" min={0} step="0.5" className="inp" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        : <Field label="Montant (DH)"><input type="number" min={0} className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
      <div className="flex justify-end"><button className="btn-pri" disabled={busy || !who || !(p.flag || Number(p.qty ? qty : amount) > 0)} onClick={() => run(async () => {
        must(await supabase.from("payroll_inputs").insert({
          period_id: period.id, profile_id: who, code, label, kind: p.kind, quantity: p.qty ? Number(qty) : null, amount: p.qty || p.flag ? null : Number(amount),
          cotisable: p.cotisable ?? true, imposable: p.imposable ?? true, created_by: me!.id,
        }));
        onDone();
      }, "Élément ajouté — recalculez la paie")}>Ajouter</button></div>
    </Modal>
  );
}

/** Tous les bulletins dans un seul document (un par page) : chargement puis impression / PDF automatique. */
function AllSlips({ slips: initial, month, title, onClose }: { slips: Slip[]; month: string; title: string; onClose: () => void }) {
  // liste figée à l'ouverture (un recalcul en temps réel ne relance pas l'impression)
  const [slips] = useState(initial);
  const [ready, setReady] = useState(0);
  const done = ready >= slips.length;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      const parts = slips.map((s) => document.getElementById(`slip-all-${s.id}`)?.innerHTML ?? "");
      printHtml(title, parts.map((h) => `<div class="slip-page">${h}</div>`).join(""));
    }, 300);
    return () => clearTimeout(t);
  }, [done, slips, title]);
  return (
    <Modal title="Télécharger tous les bulletins" onClose={onClose}>
      <p className="mb-2">{done ? "Bulletins prêts : la fenêtre d'impression s'ouvre. Choisissez « Enregistrer en PDF »." : `Préparation des bulletins… ${ready} / ${slips.length}`}</p>
      <div className="h-2 overflow-hidden rounded bg-gray2-l"><div className="h-full bg-pri transition-all" style={{ width: `${(ready / Math.max(slips.length, 1)) * 100}%` }} /></div>
      {done && <div className="mt-3 flex justify-end"><button className="btn-pri" onClick={() => {
        const parts = slips.map((s) => document.getElementById(`slip-all-${s.id}`)?.innerHTML ?? "");
        printHtml(title, parts.map((h) => `<div class="slip-page">${h}</div>`).join(""));
      }}>Rouvrir l&apos;impression / PDF</button></div>}
      <div aria-hidden className="pointer-events-none fixed left-[-10000px] top-0 w-[820px]">
        {slips.map((s) => <div key={s.id} id={`slip-all-${s.id}`}><PayslipView slip={s} month={month} onReady={() => setReady((n) => n + 1)} /></div>)}
      </div>
    </Modal>
  );
}
