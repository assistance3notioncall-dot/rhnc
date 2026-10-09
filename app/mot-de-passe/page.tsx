"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Logo } from "@/components/Logo";

export default function ChangePassword() {
  const router = useRouter();
  const { ready, session, reload } = useSession();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (ready && !session) router.replace("/login"); }, [ready, session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (p1.length < 8) return setErr("8 caractères minimum");
    if (p1 !== p2) return setErr("Les deux mots de passe ne correspondent pas");
    setBusy(true);
    // Edge Function "change-password" : change le mot de passe et lève le drapeau
    // côté serveur. Le navigateur n'a pas le droit d'écrire `must_change_password`.
    const { error } = await supabase.functions.invoke("change-password", { body: { password: p1 } });
    if (error) {
      let msg = "Le changement de mot de passe a échoué";
      try { const b = await (error as { context?: Response })?.context?.json(); if (b?.error) msg = b.error; } catch { /* */ }
      setBusy(false); return setErr(msg);
    }
    // Le drapeau est une claim du JWT : sans rafraîchissement, le jeton courant
    // porte encore `must_change_password: true` et /mot-de-passe se rouvrirait.
    const { error: refreshErr } = await supabase.auth.refreshSession();
    setBusy(false);
    if (refreshErr) { await supabase.auth.signOut(); return router.replace("/login"); }
    await reload();
    router.replace("/");
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm">
        <Logo />
        <h1 className="mb-1 mt-6">Choisissez votre mot de passe</h1>
        <p className="mut mb-5">Première connexion : remplacez le mot de passe provisoire.</p>
        <label className="mb-3.5 block"><span className="lbl">Nouveau mot de passe</span>
          <input className="inp" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} /></label>
        <label className="mb-3.5 block"><span className="lbl">Confirmer</span>
          <input className="inp" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></label>
        {err && <div className="mb-3 rounded-lg bg-err-l px-3 py-2 text-err">{err}</div>}
        <button className="btn-pri w-full justify-center" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
      </form>
    </div>
  );
}
