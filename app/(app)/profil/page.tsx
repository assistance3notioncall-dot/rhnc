"use client";
import { useEffect, useState } from "react";
import { supabase, must } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { Field, Modal, PageHead, useAction } from "@/components/ui";
import { dfr, dh, fullName, initials } from "@/lib/format";

export default function Profil() {
  const { me, roleLabel } = useSession();
  const [dept, setDept] = useState("");
  const [manager, setManager] = useState("");
  const [comp, setComp] = useState<{ base_salary: number; cnss_number: string | null; rib: string | null } | null>(null);
  const [pwd, setPwd] = useState(false);
  const [maj, setMaj] = useState(false);

  useEffect(() => {
    if (!me) return;
    if (me.department_id) supabase.from("departments").select("name").eq("id", me.department_id).maybeSingle().then(({ data }) => setDept(data?.name ?? ""));
    if (me.manager_id) supabase.from("team_directory").select("first_name,last_name").eq("id", me.manager_id).maybeSingle().then(({ data }) => setManager(fullName(data)));
    supabase.from("employee_compensation").select("base_salary,cnss_number,rib").eq("profile_id", me.id).maybeSingle().then(({ data }) => setComp(data));
  }, [me]);
  if (!me) return null;

  const rows: [string, React.ReactNode][] = [
    ["Matricule", me.matricule], ["Identifiant", "@" + me.username], ["Rôle", roleLabel], ["Poste", me.job_title], ["Section", dept],
    ["Responsable", manager], ["Date d'embauche", dfr(me.hire_date)], ["Contrat", me.contract_type], ["E-mail", me.email?.endsWith("rh360.local") ? "—" : me.email],
    ["Téléphone", me.phone], ["CIN", me.cin], ["Situation familiale", me.family_status], ["Enfants", me.children_count], ["Adresse", me.address],
    ["Contact d'urgence", me.emergency_contact],
  ];
  return (
    <Guard module="profil">
      <PageHead title="Mon profil">
        <button className="btn" onClick={() => setMaj(true)}>Demander une mise à jour</button>
        <button className="btn-pri" onClick={() => setPwd(true)}>Changer mon mot de passe</button>
      </PageHead>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="card text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-pri-l text-xl font-bold text-pri-d">{initials(me)}</div>
          <h2 className="mt-3">{fullName(me)}</h2>
          <p className="mut">{me.job_title ?? roleLabel}</p>
          {comp && (
            <div className="mt-4 rounded-lg bg-gray2-l p-3 text-left text-[13px]">
              <div className="flex justify-between"><span className="mut">Salaire de base</span><b>{dh(comp.base_salary)}</b></div>
              <div className="flex justify-between"><span className="mut">N° CNSS</span><span>{comp.cnss_number ?? "—"}</span></div>
              <div className="flex justify-between"><span className="mut">RIB</span><span>{comp.rib ? "•••• " + comp.rib.slice(-4) : "—"}</span></div>
            </div>
          )}
        </div>
        <div className="card">
          <div className="grid gap-x-6 sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k} className="border-b border-line py-2.5">
                <div className="mut text-[12px]">{k}</div>
                <div className="font-medium">{v || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {pwd && <PasswordModal onClose={() => setPwd(false)} />}
      {maj && <MajModal onClose={() => setMaj(false)} />}
    </Guard>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [p1, setP1] = useState(""); const [p2, setP2] = useState("");
  const { busy, run } = useAction();
  return (
    <Modal title="Changer mon mot de passe" onClose={onClose}>
      <Field label="Nouveau mot de passe (8 caractères min.)"><input type="password" className="inp" value={p1} onChange={(e) => setP1(e.target.value)} /></Field>
      <Field label="Confirmer"><input type="password" className="inp" value={p2} onChange={(e) => setP2(e.target.value)} /></Field>
      <div className="flex justify-end"><button className="btn-pri" disabled={busy || p1.length < 8 || p1 !== p2}
        onClick={() => run(async () => { const { error } = await supabase.auth.updateUser({ password: p1 }); if (error) throw error; onClose(); }, "Mot de passe modifié")}>Enregistrer</button></div>
    </Modal>
  );
}

function MajModal({ onClose }: { onClose: () => void }) {
  const { me } = useSession();
  const [txt, setTxt] = useState("");
  const { busy, run } = useAction();
  return (
    <Modal title="Demander une mise à jour" onClose={onClose}>
      <p className="mut mb-3">Indiquez ce qui doit changer (adresse, téléphone, situation familiale, RIB…). Les RH mettront votre fiche à jour.</p>
      <Field label="Modifications"><textarea className="inp" rows={4} value={txt} onChange={(e) => setTxt(e.target.value)} /></Field>
      <div className="flex justify-end"><button className="btn-pri" disabled={busy || txt.trim().length < 4} onClick={() => run(async () => {
        must(await supabase.from("requests").insert({ company_id: me!.company_id, profile_id: me!.id, kind: "maj_profil", comment: txt, status: "envoyee" }));
        onClose();
      }, "Demande envoyée aux RH")}>Envoyer</button></div>
    </Modal>
  );
}
