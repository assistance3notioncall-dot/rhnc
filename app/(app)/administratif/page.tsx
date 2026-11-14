"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Empty, Field, Modal, PageHead, Tabs, useAction } from "@/components/ui";
import { dfr, downloadCSV, fullName } from "@/lib/format";

// Onglet « Suivi Administratif » : informations administratives du personnel (ex-feuille Notion Workforce).
// Accès réglé par rôle dans Utilisateurs & rôles : « voir » = consulter, « modifier » = changer statut, contrat, banque.
// Même regroupement que Paie et Salariés (profiles.groupe).
const GROUPS: [string, string][] = [["direction", "Direction"], ["back_office", "Back office"], ["agents", "Agents"], ["extra", "Entretien & logistique"]];
const groupRank = (g: string) => { const i = GROUPS.findIndex(([k]) => k === g); return i < 0 ? GROUPS.length : i; };
const groupLabel = (g: string) => GROUPS.find(([k]) => k === g)?.[1] ?? "Sans groupe";
const STATUS_RANK: Record<string, number> = { actif: 0, suspendu: 1, inactif: 2, sorti: 3 };
// Deux choix seulement : Actif / Inactif (suspendu et sorti en base s'affichent « Inactif »)
const STATUS_LABEL: Record<string, string> = { actif: "Actif", inactif: "Inactif" };
const simple = (s: string) => (s === "actif" ? "actif" : "inactif");

type Row = {
  id: string; first_name: string; last_name: string; matricule: string | null; cin: string | null; address: string | null;
  birth_date: string | null; phone: string | null; emergency_contact: string | null; hire_date: string | null;
  status: string; groupe: string | null; contract_signed: boolean | null;
};
type Line = Row & { g: string; cnss: string | null; rib: string | null; bank: string | null };

export default function Administratif() {
  const { can } = useSession();
  const canView = can("administratif");
  const canEdit = can("administratif", true);
  const [lines, setLines] = useState<Line[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [fGroup, setFGroup] = useState("tous");
  const [fStatus, setFStatus] = useState("actifs");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Line | null>(null);
  const { busy, run } = useAction();
  const setStatus = (l: Line, v: string) => {
    if (v === simple(l.status)) return;
    if (v !== "actif" && !confirm(`Passer ${fullName(l)} en « ${STATUS_LABEL[v]} » ? Son accès au site sera coupé.`)) return;
    run(async () => {
      must(await supabase.rpc("set_admin_status", { p_profile: l.id, p_status: v }));
      setLines((x) => x.map((y) => (y.id === l.id ? { ...y, status: v } : y)));
    }, "Statut enregistré");
  };
  const setContract = (l: Line, v: boolean) => run(async () => {
    must(await supabase.rpc("set_admin_info", { p_profile: l.id, p_bank: l.bank ?? "", p_contract_signed: v }));
    setLines((x) => x.map((y) => (y.id === l.id ? { ...y, contract_signed: v } : y)));
  }, "Contrat enregistré");

  const load = useCallback(async () => {
    // Fonction en base : vérifie le droit « voir » et exclut les comptes hors effectif
    const { data } = await supabase.rpc("admin_roster");
    setLines(((data as (Row & { cnss_number: string | null; rib: string | null; bank_name: string | null })[]) ?? []).map((r) => (
      { ...r, g: r.groupe ?? "agents", cnss: r.cnss_number, rib: r.rib, bank: r.bank_name })));
    setLoaded(true);
  }, []);
  useEffect(() => { if (canView) load(); }, [canView, load]);

  const needle = q.trim().toLowerCase();
  const byStatus = lines.filter((l) => fStatus === "tous" || (fStatus === "actifs" ? l.status === "actif" : l.status !== "actif"));
  const shown = byStatus
    .filter((l) => fGroup === "tous" || l.g === fGroup)
    .filter((l) => !needle || [fullName(l), l.cin, l.phone, l.matricule].some((v) => (v ?? "").toLowerCase().includes(needle)))
    .sort((a, b) => groupRank(a.g) - groupRank(b.g)
      || (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
      || fullName(a).localeCompare(fullName(b)));
  const count = (g: string) => byStatus.filter((l) => l.g === g).length;

  const exportCSV = () => downloadCSV(`administratif-${new Date().toISOString().slice(0, 10)}.csv`, shown.map((l) => ({
    groupe: groupLabel(l.g), statut: STATUS_LABEL[simple(l.status)], nom: fullName(l), cin: l.cin ?? "", adresse: l.address ?? "",
    ddn: l.birth_date ? dfr(l.birth_date) : "", contact: l.phone ?? "", urgence: l.emergency_contact ?? "", cnss: l.cnss ?? "",
    rib: l.rib ?? "", banque: l.bank ?? "", date_rentree: l.hire_date ? dfr(l.hire_date) : "", contrat: l.contract_signed ? "oui" : "pas encore",
  })));

  const cell = (v: string | null | undefined, cls = "") => <td className={cls}>{v ? v : <span className="text-mut">—</span>}</td>;

  return (
    <Guard module="administratif">
      <PageHead title="Suivi Administratif" sub="Informations administratives du personnel : identité, coordonnées, CNSS, banque et contrat.">
        <input className="inp w-56" placeholder="Rechercher (nom, CIN, tél.)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp w-auto" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="actifs">Actifs</option><option value="inactifs">Inactifs</option><option value="tous">Tous</option>
        </select>
        <button className="btn" disabled={!shown.length} onClick={exportCSV}>Exporter (CSV)</button>
      </PageHead>
      {loaded && lines.length > 0 && (
        <Tabs value={fGroup} onChange={setFGroup} tabs={[{ key: "tous", label: `Tous (${byStatus.length})` },
          ...GROUPS.map(([k, l]) => ({ key: k, label: `${l} (${count(k)})` })).filter((t) => !t.label.endsWith("(0)"))]} />
      )}
      <div className="card max-h-[calc(100vh-9rem)] overflow-auto p-0">
        {!loaded ? <Empty>Chargement…</Empty> : shown.length === 0 ? <Empty>Aucun salarié pour ce filtre.</Empty> : (
          <table className="tbl text-[13px] [&_td]:whitespace-nowrap [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:shadow-[inset_0_-1px_0_#e5e7eb]">
            <thead>
              <tr className="[&_th]:text-[11px]">
                <th className="sticky left-0 z-20 bg-[#fafbfd]">Salarié</th>
                <th>Statut</th><th>CIN</th><th>Adresse</th><th>Date de naissance</th><th>Contact</th><th>Contact urgent</th>
                <th className="bg-[#f0f9ff]">CNSS</th><th className="bg-[#f0f9ff]">RIB</th><th className="bg-[#f0f9ff]">Banque</th>
                <th>Date de rentrée</th><th>Contrat</th><th />
              </tr>
            </thead>
            <tbody>{shown.map((l, i) => {
              const head = i === 0 || shown[i - 1].g !== l.g;
              return (<Fragment key={l.id}>
                {head && (
                  <tr className="bg-gray2-l text-[12px]">
                    <td colSpan={13} className="sticky left-0 z-[1] bg-gray2-l py-1.5 font-bold uppercase tracking-wide text-pri-d">
                      {groupLabel(l.g)} <span className="mut font-normal normal-case">· {shown.filter((x) => x.g === l.g).length}</span>
                    </td>
                  </tr>)}
                <tr>
                  <td className="sticky left-0 z-[1] bg-white">
                    <div className="font-medium">{fullName(l)}</div>
                    {l.matricule && <div className="mut text-[11.5px]">{l.matricule}</div>}
                  </td>
                  <td>
                    <select className={`inp w-auto py-1 text-[12.5px] ${l.status === "actif" ? "text-ok" : "text-mut"}`} disabled={busy || !canEdit} value={simple(l.status)} onChange={(e) => setStatus(l, e.target.value)}>
                      {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  {cell(l.cin, "font-mono text-[12px]")}
                  <td className="max-w-[240px] truncate" title={l.address ?? ""}>{l.address || <span className="text-mut">—</span>}</td>
                  {cell(l.birth_date ? dfr(l.birth_date) : null)}
                  {cell(l.phone)}
                  {cell(l.emergency_contact)}
                  {cell(l.cnss, "bg-[#f0f9ff] font-mono text-[12px]")}
                  {cell(l.rib, "bg-[#f0f9ff] font-mono text-[12px]")}
                  {cell(l.bank, "bg-[#f0f9ff]")}
                  {cell(l.hire_date ? dfr(l.hire_date) : null)}
                  <td>
                    <select className={`inp w-auto py-1 text-[12.5px] ${l.contract_signed ? "text-ok" : "text-warn"}`} disabled={busy || !canEdit} value={l.contract_signed ? "oui" : "non"} onChange={(e) => setContract(l, e.target.value === "oui")}>
                      <option value="oui">Oui</option><option value="non">Pas encore</option>
                    </select>
                  </td>
                  <td className="text-right">{canEdit && <button className="btn btn-sm" onClick={() => setEdit(l)}>Banque</button>}</td>
                </tr>
              </Fragment>);
            })}</tbody>
          </table>
        )}
      </div>
      {edit && <EditModal line={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
    </Guard>
  );
}

function EditModal({ line, onClose, onDone }: { line: Line; onClose: () => void; onDone: () => void }) {
  const [bank, setBank] = useState(line.bank ?? "");
  const { busy, run } = useAction();
  return (
    <Modal title={`Banque — ${fullName(line)}`} onClose={onClose}>
      <Field label="Banque"><input className="inp" placeholder="Ex. CIH, Attijariwafa Bank, Barid Bank…" value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
      <p className="mut mb-3 text-[12.5px]">CIN, adresse, contacts, CNSS, RIB et date de rentrée se modifient depuis la fiche dans « Salariés ».</p>
      <div className="flex justify-end"><button className="btn-pri" disabled={busy} onClick={() => run(async () => {
        must(await supabase.rpc("set_admin_info", { p_profile: line.id, p_bank: bank, p_contract_signed: !!line.contract_signed }));
        onDone();
      }, "Enregistré")}>Enregistrer</button></div>
    </Modal>
  );
}
