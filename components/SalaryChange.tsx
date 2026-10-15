"use client";
import { useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Field, Modal, useAction } from "@/components/ui";
import { dh, monthStart } from "@/lib/format";

/** Proposer (ou appliquer directement si droit "modifier") un nouveau salaire de base. */
export function SalaryChangeModal({ person, current, onClose, onDone }: {
  person: { id: string; name: string }; current?: number | null; onClose: () => void; onDone: () => void;
}) {
  const { can } = useSession();
  const direct = can("salaire_base", true);
  const [amount, setAmount] = useState(current ? String(current) : "");
  const [month, setMonth] = useState(monthStart().slice(0, 7));
  const [reason, setReason] = useState("");
  const { busy, run } = useAction();
  return (
    <Modal title={`Salaire de base — ${person.name}`} onClose={onClose}>
      {current != null && <p className="mb-3">Salaire actuel : <b>{dh(current)}</b></p>}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Nouveau salaire (DH brut)"><input type="number" min={1} className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="À partir du mois"><input type="month" className="inp" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
      </div>
      <Field label="Motif (obligatoire)"><input className="inp" placeholder="Augmentation annuelle, fin de période d'essai…" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <p className="mut mb-3 text-[12.5px]">{direct ? "Votre rôle applique le changement immédiatement (historisé)." : "Le changement sera envoyé pour validation au super admin / RH."}</p>
      <div className="flex justify-end">
        <button className="btn-pri" disabled={busy || !(Number(amount) > 0) || reason.trim().length < 3} onClick={() => run(async () => {
          must(await supabase.rpc("request_salary_change", { p_profile: person.id, p_new: Number(amount), p_effective: month + "-01", p_reason: reason }));
          onDone();
        }, direct ? "Nouveau salaire appliqué" : "Proposition envoyée pour validation")}>{direct ? "Appliquer" : "Proposer"}</button>
      </div>
    </Modal>
  );
}
