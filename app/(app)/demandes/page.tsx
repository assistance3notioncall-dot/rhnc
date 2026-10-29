"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Badge, Empty, Field, Modal, PageHead, Tabs, useAction } from "@/components/ui";
import { dfr, dh, dtfr, KIND, num } from "@/lib/format";
import type { RequestRow } from "@/lib/types";

type LeaveType = { id: string; code: string; label: string; requires_attachment: boolean; deducts_balance: boolean; default_days: number | null };
type Template = { id: string; name: string };
type Event = { id: number; action: string; comment: string | null; created_at: string; to_status: string | null };

function DemandesInner() {
  const { me } = useSession();
  const params = useSearchParams();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [tpls, setTpls] = useState<Template[]>([]);
  const [filter, setFilter] = useState("tous");
  const [form, setForm] = useState<string | null>(params.get("new"));
  const [detail, setDetail] = useState<RequestRow | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    if (!me) return;
    const { data } = await supabase.from("requests").select("*").eq("profile_id", me.id).order("created_at", { ascending: false });
    setRows((data as RequestRow[]) ?? []);
  }, [me]);

  useEffect(() => {
    load();
    supabase.from("leave_types").select("*").eq("active", true).order("sort").then(({ data }) => setTypes((data as LeaveType[]) ?? []));
    supabase.from("document_templates").select("id,name").eq("active", true).order("name").then(({ data }) => setTpls((data as Template[]) ?? []));
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    supabase.from("request_events").select("*").eq("request_id", detail.id).order("created_at").then(({ data }) => setEvents((data as Event[]) ?? []));
  }, [detail]);

  const shown = rows.filter((r) =>
    filter === "tous" ? true : filter === "cours" ? ["brouillon", "envoyee", "valid_mgr", "valid_rh"].includes(r.status) : ["traitee", "refusee", "annulee"].includes(r.status),
  );
  const typeLabel = (id: string | null) => types.find((t) => t.id === id)?.label;
  const tplLabel = (id: string | null) => tpls.find((t) => t.id === id)?.name;

  return (
    <Guard module="demandes">
      <PageHead title="Mes demandes" sub="Congés, attestations, avances et réclamations.">
        <button className="btn" onClick={() => setForm("document")}>Demander un document</button>
        <button className="btn-pri" onClick={() => setForm("absence")}>+ Nouvelle demande</button>
      </PageHead>
      <Tabs value={filter} onChange={setFilter} tabs={[{ key: "tous", label: "Toutes" }, { key: "cours", label: "En cours" }, { key: "fini", label: "Clôturées" }]} />
      <div className="card overflow-x-auto p-0">
        {shown.length === 0 ? <Empty>Aucune demande.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Réf.</th><th>Type</th><th>Détail</th><th>Envoyée le</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => setDetail(r)}>
                  <td className="font-medium">{r.ref}</td>
                  <td>{KIND[r.kind]}</td>
                  <td className="mut">
                    {r.kind === "absence" && <>{typeLabel(r.leave_type_id)} · {dfr(r.start_date)} → {dfr(r.end_date)} ({num(r.days, 1)} j)</>}
                    {r.kind === "document" && tplLabel(r.template_id)}
                    {r.kind === "avance" && dh(r.amount)}
                    {r.kind === "reclamation" && r.category}
                  </td>
                  <td className="mut">{dtfr(r.submitted_at ?? r.created_at)}</td>
                  <td><Badge status={r.status} /></td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {r.status === "brouillon" && (
                      <button className="btn btn-sm" disabled={busy} onClick={() => run(async () => { must(await supabase.rpc("submit_request", { p_id: r.id })); await load(); }, "Demande envoyée")}>Envoyer</button>
                    )}
                    {["brouillon", "envoyee", "valid_mgr", "valid_rh"].includes(r.status) && (
                      <button className="btn-no btn-sm ml-1" disabled={busy} onClick={() => confirm("Annuler cette demande ?") && run(async () => { must(await supabase.rpc("cancel_request", { p_id: r.id })); await load(); }, "Demande annulée")}>Annuler</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form && me && <NewRequest kind={form} types={types} tpls={tpls} onClose={() => setForm(null)} onDone={() => { setForm(null); load(); }} />}

      {detail && (
        <Modal title={`Demande ${detail.ref}`} onClose={() => setDetail(null)}>
          <div className="mb-3 flex items-center gap-2"><Badge status={detail.status} /><span className="mut">{KIND[detail.kind]}</span></div>
          {detail.comment && <p className="mb-3">« {detail.comment} »</p>}
          {detail.rejection_reason && <p className="mb-3 rounded-lg bg-err-l px-3 py-2 text-err">Motif du refus : {detail.rejection_reason}</p>}
          <h3 className="mb-2">Historique</h3>
          <ol className="border-l-2 border-line pl-4">
            {events.map((e) => (
              <li key={e.id} className="mb-2">
                <div className="font-medium capitalize">{e.action.replace("_", " ")}</div>
                <div className="mut text-[12.5px]">{dtfr(e.created_at)}{e.comment ? ` — ${e.comment}` : ""}</div>
              </li>
            ))}
            {events.length === 0 && <li className="mut">Pas encore envoyée.</li>}
          </ol>
        </Modal>
      )}
    </Guard>
  );
}

function NewRequest({ kind: initial, types, tpls, onClose, onDone }: {
  kind: string; types: LeaveType[]; tpls: Template[]; onClose: () => void; onDone: () => void;
}) {
  const { me } = useSession();
  const [kind, setKind] = useState(initial);
  const [lt, setLt] = useState(types[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [solde, setSolde] = useState<number | null>(null);
  const [tpl, setTpl] = useState(tpls[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  // Plafond des avances : 1 500 DH par mois (réglage société), moins ce qui est déjà demandé ce mois-ci
  const [adv, setAdv] = useState<{ cap: number; used: number; remaining: number } | null>(null);
  const [category, setCategory] = useState("Erreur de paie");
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const { busy, run } = useAction();
  const type = types.find((t) => t.id === lt);

  useEffect(() => { if (!lt && types[0]) setLt(types[0].id); if (!tpl && tpls[0]) setTpl(tpls[0].id); }, [types, tpls, lt, tpl]);
  useEffect(() => {
    if (!me || kind !== "avance") return;
    supabase.rpc("advance_status").then(({ data }) => {
      const a = (data as { cap: number; used: number; remaining: number }[] | null)?.[0];
      if (a) setAdv({ cap: Number(a.cap), used: Number(a.used), remaining: Number(a.remaining) });
    });
  }, [me, kind]);
  useEffect(() => {
    if (!me || !lt) return;
    supabase.rpc("balance_of", { p_profile: me.id, p_leave_type: lt }).then(({ data }) => setSolde(Number(data ?? 0)));
  }, [me, lt]);
  useEffect(() => {
    if (!me || !lt || !start || !end || end < start) { setDays(null); return; }
    supabase.rpc("count_days", { p_company: me.company_id, p_leave_type: lt, p_start: start, p_end: end }).then(({ data }) => setDays(Number(data ?? 0)));
  }, [me, lt, start, end]);

  async function save(send: boolean) {
    if (!me) return;
    await run(async () => {
      let attachment_path: string | null = null;
      if (file) {
        attachment_path = `${me.company_id}/${me.id}/justificatifs/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        must(await supabase.storage.from("documents").upload(attachment_path, file));
      }
      const row: Record<string, unknown> = { company_id: me.company_id, profile_id: me.id, kind, comment: comment || null, status: "brouillon", attachment_path };
      if (kind === "absence") Object.assign(row, { leave_type_id: lt, start_date: start, end_date: end });
      if (kind === "document") row.template_id = tpl;
      if (kind === "avance") row.amount = Number(amount);
      if (kind === "reclamation") row.category = category;
      const created = must(await supabase.from("requests").insert(row).select("id").single()) as { id: string };
      if (send) must(await supabase.rpc("submit_request", { p_id: created.id }));
      onDone();
    }, send ? "Demande envoyée" : "Brouillon enregistré");
  }

  const valid = kind === "absence" ? !!(lt && start && end && end >= start && (!type?.requires_attachment || file))
    : kind === "document" ? !!tpl : kind === "avance" ? Number(amount) > 0 && (adv == null || Number(amount) <= adv.remaining) : comment.trim().length > 3;

  return (
    <Modal title="Nouvelle demande" onClose={onClose}>
      <Tabs value={kind} onChange={setKind} tabs={[
        { key: "absence", label: "Congé / absence" }, { key: "document", label: "Document" },
        { key: "avance", label: "Avance" }, { key: "reclamation", label: "Réclamation" },
      ]} />
      {kind === "absence" && (
        <>
          <Field label="Type">
            <select className="inp" value={lt} onChange={(e) => setLt(e.target.value)}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}{t.default_days ? ` (${t.default_days} j)` : ""}</option>)}
            </select>
          </Field>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Field label="Du"><input type="date" className="inp" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Au"><input type="date" className="inp" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <div className="mb-3 rounded-lg bg-pri-l px-3 py-2 text-pri-d">
            {days != null ? <><b>{num(days, 1)} jour(s)</b> décomptés (dimanches et fériés exclus)</> : "Choisissez les dates"}
            {type?.deducts_balance && solde != null && <> · solde disponible : <b>{num(solde, 1)} j</b></>}
          </div>
          <Field label={`Justificatif${type?.requires_attachment ? " (obligatoire)" : " (facultatif)"}`}>
            <input type="file" className="inp" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </>
      )}
      {kind === "document" && (
        <Field label="Document souhaité">
          <select className="inp" value={tpl} onChange={(e) => setTpl(e.target.value)}>
            {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      )}
      {kind === "avance" && (<>
        <Field label="Montant (DH)"><input type="number" min={1} max={adv?.remaining} className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {adv && (
          <div className={`mb-3 rounded-lg px-3 py-2 ${Number(amount) > adv.remaining ? "bg-err-l text-err" : "bg-pri-l text-pri-d"}`}>
            Avances limitées à <b>{dh(adv.cap)}</b> par mois · déjà demandé ce mois-ci : {dh(adv.used)} · reste : <b>{dh(adv.remaining)}</b>
            {Number(amount) > adv.remaining && <> — montant trop élevé</>}
          </div>
        )}
      </>)}
      {kind === "reclamation" && (
        <Field label="Catégorie">
          <select className="inp" value={category} onChange={(e) => setCategory(e.target.value)}>
            {["Erreur de paie", "Pointage", "Solde de congés", "Prime / challenge", "Autre"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
      )}
      <Field label={kind === "reclamation" ? "Description" : "Commentaire (facultatif)"}>
        <textarea className="inp" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <button className="btn" disabled={busy || !valid} onClick={() => save(false)}>Enregistrer le brouillon</button>
        <button className="btn-pri" disabled={busy || !valid} onClick={() => save(true)}>Envoyer</button>
      </div>
    </Modal>
  );
}

export default function Demandes() {
  return <Suspense><DemandesInner /></Suspense>;
}
