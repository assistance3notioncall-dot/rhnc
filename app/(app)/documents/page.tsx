"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Empty, Field, Modal, PageHead, Tabs, useAction } from "@/components/ui";
import { PayslipView, type Slip } from "@/components/Payslip";
import { dfr, dh, fullName, monthLabel } from "@/lib/format";
import { printHtml } from "@/lib/print";

type Doc = { id: string; profile_id: string | null; category: string; title: string; storage_path: string | null; content_html: string | null; requires_ack: boolean; created_at: string };
type Period = { id: string; month: string; status: string };
const CAT: Record<string, string> = { contrat: "Contrat", avenant: "Avenant", bulletin: "Bulletin", attestation: "Attestation", justificatif: "Justificatif", entreprise: "Entreprise", autre: "Autre" };

export default function Documents() {
  const { me, can } = useSession();
  const isHr = me?.role === "rh" || me?.role === "admin";
  const [tab, setTab] = useState("mes");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [acks, setAcks] = useState<string[]>([]);
  const [slips, setSlips] = useState<(Slip & { month: string })[]>([]);
  const [view, setView] = useState<Doc | null>(null);
  const [slip, setSlip] = useState<(Slip & { month: string }) | null>(null);
  const [upload, setUpload] = useState(false);
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    if (!me) return;
    const q = supabase.from("documents").select("id,profile_id,category,title,storage_path,content_html,requires_ack,created_at").order("created_at", { ascending: false });
    const { data } = tab === "entreprise" ? await q.is("profile_id", null) : await q.eq("profile_id", me.id);
    setDocs((data as Doc[]) ?? []);
    const { data: a } = await supabase.from("document_acks").select("document_id").eq("profile_id", me.id);
    setAcks((a ?? []).map((x) => x.document_id));
    if (tab === "bulletins") {
      const { data: per } = await supabase.from("payroll_periods").select("id,month,status").in("status", ["validee", "cloturee"]).order("month", { ascending: false });
      const ids = ((per as Period[]) ?? []).map((p) => p.id);
      if (ids.length) {
        const { data: s } = await supabase.from("payslips").select("*").eq("profile_id", me.id).in("period_id", ids);
        setSlips(((s as Slip[]) ?? []).map((x) => ({ ...x, month: (per as Period[]).find((p) => p.id === x.period_id)!.month })).sort((a, b) => b.month.localeCompare(a.month)));
      } else setSlips([]);
    }
  }, [me, tab]);
  useEffect(() => { load(); }, [load]);

  async function open(d: Doc) {
    if (d.content_html) return setView(d);
    if (d.storage_path) {
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(d.storage_path, 120);
      if (!error && data) window.open(data.signedUrl, "_blank");
    }
  }

  return (
    <Guard module="documents">
      <PageHead title="Documents" sub="Vos attestations, contrats, bulletins et les documents de l'entreprise.">
        {isHr && <button className="btn-pri" onClick={() => setUpload(true)}>+ Déposer un document</button>}
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "mes", label: "Mes documents" }, { key: "bulletins", label: "Mes bulletins de paie" }, { key: "entreprise", label: "Entreprise" }]} />

      {tab !== "bulletins" ? (
        <div className="card overflow-x-auto p-0">
          {docs.length === 0 ? <Empty>Aucun document.</Empty> : (
            <table className="tbl">
              <thead><tr><th>Document</th><th>Catégorie</th><th>Date</th><th /></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.title}</td>
                    <td>{CAT[d.category] ?? d.category}</td>
                    <td className="mut">{dfr(d.created_at)}</td>
                    <td className="text-right">
                      <button className="btn btn-sm" onClick={() => open(d)}>Ouvrir</button>
                      {d.requires_ack && !acks.includes(d.id) && (
                        <button className="btn-pri btn-sm ml-1" disabled={busy} onClick={() => run(async () => {
                          must(await supabase.from("document_acks").insert({ document_id: d.id, profile_id: me!.id })); await load();
                        }, "Lecture confirmée")}>J&apos;ai lu</button>
                      )}
                      {d.requires_ack && acks.includes(d.id) && <span className="badge ml-1 bg-ok-l text-ok">Lu ✓</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          {slips.length === 0 ? <Empty>Aucun bulletin validé pour l&apos;instant.</Empty> : (
            <table className="tbl">
              <thead><tr><th>Mois</th><th className="text-right">Brut</th><th className="text-right">Net à payer</th><th /></tr></thead>
              <tbody>
                {slips.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium capitalize">{monthLabel(s.month)}</td>
                    <td className="text-right">{dh(s.gross)}</td>
                    <td className="text-right font-semibold">{dh(s.net_pay)}</td>
                    <td className="text-right"><button className="btn btn-sm" onClick={() => setSlip(s)}>Voir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view && (
        <Modal title={view.title} onClose={() => setView(null)} wide>
          <div id="print-doc" className="prose max-w-none rounded-lg border border-line p-8" dangerouslySetInnerHTML={{ __html: view.content_html ?? "" }} />
          <div className="no-print mt-3 flex justify-end"><button className="btn-pri" onClick={() => printHtml(view.title, view.content_html ?? "")}>Imprimer / PDF</button></div>
        </Modal>
      )}
      {slip && (
        <Modal title="Bulletin de paie" onClose={() => setSlip(null)} wide>
          <div id="slip"><PayslipView slip={slip} month={slip.month} /></div>
          <div className="mt-3 flex justify-end"><button className="btn-pri" onClick={() => printHtml("Bulletin", document.getElementById("slip")?.innerHTML ?? "")}>Imprimer / PDF</button></div>
        </Modal>
      )}
      {upload && <UploadDoc onClose={() => setUpload(false)} onDone={() => { setUpload(false); load(); }} />}
      {!can("documents", true) && null}
    </Guard>
  );
}

function UploadDoc({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const [people, setPeople] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [who, setWho] = useState("entreprise");
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState("contrat");
  const [ack, setAck] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    supabase.from("profiles").select("id,first_name,last_name").eq("status", "actif").order("first_name").then(({ data }) => setPeople(data ?? []));
  }, []);
  return (
    <Modal title="Déposer un document" onClose={onClose}>
      <Field label="Pour"><select className="inp" value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="entreprise">Toute l&apos;entreprise</option>
        {people.map((p) => <option key={p.id} value={p.id}>{fullName(p)}</option>)}
      </select></Field>
      <Field label="Titre"><input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Catégorie"><select className="inp" value={cat} onChange={(e) => setCat(e.target.value)}>
        {Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select></Field>
      <Field label="Fichier (PDF)"><input type="file" className="inp" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      <label className="mb-4 flex items-center gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Demander un accusé de lecture</label>
      <div className="flex justify-end">
        <button className="btn-pri" disabled={busy || !file || !title} onClick={() => run(async () => {
          const path = `${me!.company_id}/${who}/${Date.now()}-${file!.name.replace(/[^\w.-]/g, "_")}`;
          must(await supabase.storage.from("documents").upload(path, file!));
          must(await supabase.from("documents").insert({
            company_id: me!.company_id, profile_id: who === "entreprise" ? null : who, category: who === "entreprise" ? "entreprise" : cat,
            title, storage_path: path, requires_ack: ack, created_by: me!.id,
          }));
          onDone();
        }, "Document déposé")}>Déposer</button>
      </div>
    </Modal>
  );
}
