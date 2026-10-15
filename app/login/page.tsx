"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Logo } from "@/components/Logo";

/**
 * La fonction `login` et la plateforme répondent toutes les deux 401 : la
 * première pour un mot de passe faux, la seconde quand elle rejette la clé
 * publique avant même d'atteindre la fonction. Sans les distinguer, un
 * problème de configuration s'affiche comme un mauvais mot de passe et on
 * cherche au mauvais endroit — c'est arrivé avec un bundle en cache qui
 * envoyait encore l'ancienne clé de repli.
 */
async function messageErreur(error: unknown): Promise<string> {
  const reponse = (error as { context?: Response } | null)?.context;
  if (!reponse) return "Serveur injoignable. Vérifiez votre connexion.";

  let corps: Record<string, unknown> | null = null;
  try { corps = await reponse.json(); } catch { /* réponse non JSON */ }

  // Message métier de la fonction `login`.
  if (typeof corps?.error === "string") return corps.error;

  // Rejet par la plateforme : clé invalide, JWT, quota… `code` vaut par
  // exemple INVALID_API_KEY.
  if (typeof corps?.code === "string") {
    return `Erreur de configuration (${corps.code}). Rechargez la page avec Ctrl+Shift+R ; si le problème persiste, prévenez l'administrateur.`;
  }

  return `Connexion impossible (erreur ${reponse.status}).`;
}

export default function LoginPage() {
  const router = useRouter();
  const { ready, session } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [oubli, setOubli] = useState(false);
  const [envoye, setEnvoye] = useState(false);

  useEffect(() => { if (ready && session) router.replace("/"); }, [ready, session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    // Edge Function "login" : identifiant → e-mail côté serveur → session
    const { data, error } = await supabase.functions.invoke("login", { body: { username: username.trim().toLowerCase(), password } });
    if (error || !data?.session) {
      setErr(error ? await messageErreur(error) : "Réponse inattendue du serveur.");
      setBusy(false); return;
    }
    await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    router.replace("/");
  }

  // Edge Function "forgot-password" : prévient le super admin. Elle répond
  // pareil que l'identifiant existe ou non, donc pas de message « inconnu ».
  async function demander(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { error } = await supabase.functions.invoke("forgot-password", { body: { username: username.trim().toLowerCase() } });
    setBusy(false);
    if (error) { setErr(await messageErreur(error)); return; }
    setEnvoye(true);
  }

  const basculer = (v: boolean) => { setOubli(v); setEnvoye(false); setErr(""); };

  return (
    <div className="grid min-h-screen bg-white md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-linear-to-br from-blue-800 via-pri to-blue-500 p-12 text-white md:flex">
        <Logo invert />
        <p className="max-w-sm text-lg opacity-95">
          Congés, documents, absences, stats RDV et bulletins de paie — au même endroit, pour toute l&apos;équipe NotionCall.
        </p>
        <span className="text-sm opacity-75">NotionCall · Marrakech</span>
      </div>
      <div className="flex items-center justify-center p-6">
        {oubli ? (
        <form onSubmit={demander} className="w-full max-w-sm">
          <div className="mb-8 md:hidden"><Logo /></div>
          <h1 className="mb-1">Mot de passe oublié</h1>
          {envoye ? (
            <div className="mb-5 mt-4 rounded-lg bg-ok-l px-3 py-2.5 text-ok">
              Votre demande a été envoyée à l&apos;administrateur. Il vous communiquera un nouveau mot de passe.
            </div>
          ) : (<>
            <p className="mut mb-6">Entrez votre identifiant : l&apos;administrateur sera prévenu et vous donnera un nouveau mot de passe.</p>
            <label className="mb-3.5 block">
              <span className="lbl">Identifiant ou e-mail</span>
              <input className="inp" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            {err && <div className="mb-3 rounded-lg bg-err-l px-3 py-2 text-err">{err}</div>}
            <button className="btn-pri w-full justify-center" disabled={busy || !username.trim()}>
              {busy ? "Envoi…" : "Envoyer la demande"}
            </button>
          </>)}
          <button type="button" className="mt-4 text-[13px] text-pri hover:underline" onClick={() => basculer(false)}>← Retour à la connexion</button>
        </form>
        ) : (
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 md:hidden"><Logo /></div>
          <h1 className="mb-1">Connexion</h1>
          <p className="mut mb-6">Entrez votre identifiant — ou votre e-mail si vous en avez un — et votre mot de passe.</p>
          <label className="mb-3.5 block">
            <span className="lbl">Identifiant ou e-mail</span>
            <input className="inp" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="mb-3.5 block">
            <span className="lbl">Mot de passe</span>
            <input className="inp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {err && <div className="mb-3 rounded-lg bg-err-l px-3 py-2 text-err">{err}</div>}
          <button className="btn-pri w-full justify-center" disabled={busy || !username || !password}>
            {busy ? "Connexion…" : "Se connecter"}
          </button>
          <button type="button" className="mt-4 text-[13px] text-pri hover:underline" onClick={() => basculer(true)}>Mot de passe oublié ? Demandez à l'admin.</button>
        </form>
        )}
      </div>
    </div>
  );
}
