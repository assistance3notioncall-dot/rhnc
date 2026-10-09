"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Badge, Empty, Field, Modal, PageHead, Tabs, useAction } from "@/components/ui";
import { dfr, dh, dtfr, fullName, KIND, monthLabel, num } from "@/lib/format";

type Req = {
  id: string; ref: string; kind: string; status: string; start_date: string | null; end_date: string | null; days: number | null;
  amount: number | null; category: string | null; comment: string | null; attachment_path: string | null; submitted_at: string | null; profile_id: string;
  profile: { first_name: string; last_name: string } | null; leave_type: { label: string } | null; template: { name: string } | null;
};
type Sal = {
  id: string; old_salary: number; new_salary: number; effective_month: string; reason: string; status: string; created_at: string;
  profile: { first_name: string; last_name: string } | null; requester: { first_name: string; last_name: string } | null;
};

export default function Validations() {
  const { me, can } = useSession();
  const isHr = me?.role === "rh" || me?.role === "admin";
  const [tab, setTab] = useState("attente");
  const [reqs, setReqs] = useState<Req[]>([]);
  const [sal, setSal] = useState<Sal[]>([]);
  const [refuse, setRefuse] = useState<{ id: string; type: "req" | "sal" } | null>(null);
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    if (!me) return;
    const statuses = tab === "attente" ? ["envoyee", "valid_mgr"] : tab === "cloturer" ? ["valid_rh"] : ["traitee", "refusee", "annulee"];
    const { data } = await supabase.from("requests")
      .select("*, profile:profiles!requests_profile_id_fkey(first_name,last_name), leave_type:leave_types(label), template:document_templates(name)")
      .in("status", statuses).neq("profile_id", me.id).order("submitted_at", { ascending: tab !== "histo" }).limit(200);
    let rows = (data as Req[]) ?? [];
    // un manager ne voit "à valider" que l'étape manager ; les RH voient l'étape RH
    if (tab === "attente" && !isHr) rows = rows.filter((r) => r.status === "envoyee");
    setReqs(rows);
    if (can("salaire_base", true)) {
      const { data: s } = await supabase.from("salary_changes")
        .select("*, profile:profiles!salary_changes_profile_id_fkey(first_name,last_name), requester:profiles!salary_changes_requested_by_fkey(first_name,last_name)")
        .eq("status", "en_attente").order("created_at");
      setSal((s as Sal[]) ?? []);
    }
  }, [me, tab, isHr, can]);
  useEffect(() => { load(); }, [load]);

  const decide = (id: string, ok: boolean, comment?: string) =>
    run(async () => { must(await supabase.rpc("decide_request", { p_id: id, p_approve: ok, p_comment: comment ?? null })); await load(); }, ok ? "Demande validée" : "Demande refusée");
  const decideSal = (id: string, ok: boolean, note?: string) =>
    run(async () => { must(await supabase.rpc("decide_salary_change", { p_id: id, p_approve: ok, p_note: note ?? null })); await load(); }, ok ? "Nouveau salaire appliqué" : "Changement refusé");
  const openFile = async (path: string) => {
    const { data } = await supabase.storage.from("documents").createSignedUrl(path, 120);
    if (data) window.open(data.signedUrl, "_blank");
  };

  const tabs = [{ key: "attente", label: `À valider` }, ...(isHr ? [{ key: "cloturer", label: "À clôturer" }] : []), { key: "histo", label: "Historique" }];
  if (can("salaire_base", true)) tabs.splice(1, 0, { key: "salaires", label: `Salaires (${sal.length})` });

  return (
    <Guard module="validations">
      <PageHead title="Validations" sub={isHr ? "Étape RH : validez, générez les documents et clôturez." : "Étape manager : validez les demandes de votre équipe."} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "salaires" ? (
        <div className="card overflow-x-auto p-0">
          {sal.length === 0 ? <Empty>Aucun changement de salaire en attente.</Empty> : (
            <table className="tbl">
              <thead><tr><th>Salarié</th><th className="text-right">Actuel</th><th className="text-right">Proposé</th><th>À partir de</th><th>Motif</th><th>Demandé par</th><th /></tr></thead>
              <tbody>{sal.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{fullName(s.profile)}</td>
                  <td className="text-right">{dh(s.old_salary)}</td>
                  <td className="text-right font-semibold">{dh(s.new_salary)} <span className={s.new_salary >= s.old_salary ? "text-ok" : "text-err"}>({s.new_salary >= s.old_salary ? "+" : ""}{num(((s.new_salary - s.old_salary) / (s.old_salary || 1)) * 100, 1)} %)</span></td>
                  <td className="capitalize">{monthLabel(s.effective_month)}</td>
                  <td className="mut">{s.reason}</td>
                  <td className="mut">{fullName(s.requester)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ok btn-sm" disabled={busy} onClick={() => decideSal(s.id, true)}>Appliquer</button>
                    <button className="btn-no btn-sm ml-1" disabled={busy} onClick={() => setRefuse({ id: s.id, type: "sal" })}>Refuser</button>
                  </td>
                </tr>))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          {reqs.length === 0 ? <Empty>Rien à traiter. 🎉</Empty> : (
            <table className="tbl">
              <thead><tr><th>Réf.</th><th>Salarié</th><th>Demande</th><th>Envoyée</th><th>Statut</th><th /></tr></thead>
              <tbody>{reqs.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.ref}</td>
                  <td>{fullName(r.profile)}</td>
                  <td>
                    <div>{KIND[r.kind]}{r.leave_type ? ` · ${r.leave_type.label}` : ""}{r.template ? ` · ${r.template.name}` : ""}</div>
                    <div className="mut text-[12.5px]">
                      {r.start_date && `${dfr(r.start_date)} → ${dfr(r.end_date)} (${num(r.days, 1)} j)`}
                      {r.amount && dh(r.amount)} {r.category} {r.comment && `« ${r.comment} »`}
                    </div>
                    {r.attachment_path && <button className="text-[12.5px] text-pri" onClick={() => openFile(r.attachment_path!)}>📎 Justificatif</button>}
                  </td>
                  <td className="mut">{dtfr(r.submitted_at)}</td>
                  <td><Badge status={r.status} /></td>
                  <td className="whitespace-nowrap text-right">
                    {tab === "attente" && <>
                      <button className="btn-ok btn-sm" disabled={busy} onClick={() => decide(r.id, true)}>{r.kind === "document" && r.status === "valid_mgr" ? "Générer" : "Valider"}</button>
                      <button className="btn-no btn-sm ml-1" disabled={busy} onClick={() => setRefuse({ id: r.id, type: "req" })}>Refuser</button>
                    </>}
                    {tab === "cloturer" && <button className="btn-pri btn-sm" disabled={busy} onClick={() => run(async () => { must(await supabase.rpc("complete_request", { p_id: r.id })); await load(); }, "Demande clôturée")}>Marquer traitée</button>}
                  </td>
                </tr>))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {refuse && <RefuseModal onClose={() => setRefuse(null)} onConfirm={async (txt) => {
        const ok = refuse.type === "req" ? await decide(refuse.id, false, txt) : await decideSal(refuse.id, false, txt);
        if (ok) setRefuse(null);
      }} />}
    </Guard>
  );
}

function RefuseModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (txt: string) => void }) {
  const [txt, setTxt] = useState("");
  return (
    <Modal title="Motif du refus" onClose={onClose}>
      <Field label="Le salarié verra ce motif"><textarea className="inp" rows={3} value={txt} onChange={(e) => setTxt(e.target.value)} /></Field>
      <div className="flex justify-end"><button className="btn-no" disabled={txt.trim().length < 3} onClick={() => onConfirm(txt)}>Refuser</button></div>
    </Modal>
  );
}
