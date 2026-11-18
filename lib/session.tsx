"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Access, Profile } from "./types";

type Ctx = {
  ready: boolean;
  session: Session | null;
  me: Profile | null;
  roleLabel: string;
  access: Access[];
  can: (module: string, edit?: boolean) => boolean;
  isSuper: boolean;
  mustChangePassword: boolean;
  /** Message d'échec du chargement du profil ou des droits, sinon null. */
  error: string | null;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionCtx = createContext<Ctx | null>(null);

/**
 * Le drapeau fait autorité dans `app_metadata` : seule la clé secrète peut l'écrire
 * (Edge Functions `create-access` et `change-password`), donc le salarié ne peut pas
 * le lever lui-même. La lecture de `user_metadata` n'est qu'un repli pour les comptes
 * créés avant la bascule — à supprimer une fois le script de migration passé.
 */
function needsPasswordChange(session: Session | null): boolean {
  if (!session) return false;
  const app = session.user.app_metadata as Record<string, unknown> | undefined;
  if (app && "must_change_password" in app) return !!app.must_change_password;
  return !!session.user.user_metadata?.must_change_password;
}

/**
 * Cache local du profil et des droits (navigateur de l'utilisateur) : au rechargement,
 * l'interface s'affiche tout de suite avec la dernière version connue, puis se met à jour.
 */
const CACHE_KEY = "rh360.session.v1";
type Cache = { uid: string; me: Profile; access: Access[]; roleLabel: string };
function readCache(uid: string): Cache | null {
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Cache | null; return c && c.uid === uid ? c : null; } catch { return null; }
}
function writeCache(c: Cache | null) {
  try { if (c) localStorage.setItem(CACHE_KEY, JSON.stringify(c)); else localStorage.removeItem(CACHE_KEY); } catch { /* stockage indisponible */ }
}

/** Profil + droits en une passe. Remonte l'erreur au lieu de la jeter. */
async function chargerProfil(userId: string) {
  const [profil, droits] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.rpc("my_access"),
  ]);
  return {
    me: (profil.data as Profile) ?? null,
    access: (droits.data as Access[]) ?? [],
    error: profil.error ?? droits.error ?? null,
  };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [roleLabel, setRoleLabel] = useState("");
  const [access, setAccess] = useState<Access[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) { setMe(null); setAccess([]); setRoleLabel(""); setError(null); writeCache(null); setReady(true); return; }

    // Affichage immédiat depuis le cache, la vérification réseau suit en arrière-plan
    const cached = readCache(s.user.id);
    if (cached) { setMe(cached.me); setAccess(cached.access); setRoleLabel(cached.roleLabel); setError(null); setReady(true); }

    // Le jeton relu depuis localStorage peut déjà être expiré. On rafraîchit
    // AVANT d'interroger : sinon les deux requêtes partent en 401 et polluent
    // la console, même quand la reprise les rejoue avec succès.
    let courante = s;
    const expireLe = (s.expires_at ?? 0) * 1000;
    if (expireLe && expireLe - Date.now() < 30_000) {
      const { data: frais } = await supabase.auth.refreshSession();
      if (frais.session) { courante = frais.session; setSession(frais.session); }
    }

    let res = await chargerProfil(courante.user.id);

    // Filet de sécurité : le jeton peut aussi être rejeté sans être expiré
    // (clé de signature changée, session révoquée depuis un autre appareil).
    if (res.error) {
      const { data: frais, error: errRefresh } = await supabase.auth.refreshSession();
      if (errRefresh || !frais.session) {
        // Session morte : on sort plutôt que de laisser l'utilisateur sur un
        // menu vide. Le SIGNED_OUT qui suit rappelle load(null).
        setMe(null); setAccess([]); setRoleLabel(""); setError(null); writeCache(null); setReady(true);
        await supabase.auth.signOut();
        return;
      }
      setSession(frais.session);
      res = await chargerProfil(frais.session.user.id);
    }

    // Jeton valide mais requêtes en échec (réseau, RLS, objet absent) : on le
    // dit. Avant, ces erreurs étaient ignorées et le menu s'affichait vide.
    if (res.error) {
      setMe(null); setAccess([]); setRoleLabel("");
      setError(res.error.message);
      setReady(true);
      return;
    }

    setError(null);
    const acc = res.access.filter((a) => a.can_view);
    setMe(res.me);
    setAccess(acc);
    setReady(true); // le libellé du rôle n'est qu'un affichage : il ne bloque plus l'ouverture
    let label = "";
    if (res.me?.role_key) {
      const { data: role } = await supabase.from("app_roles").select("label").eq("key", res.me.role_key).maybeSingle();
      label = role?.label ?? res.me.role_key;
    }
    setRoleLabel(label);
    if (res.me) writeCache({ uid: res.me.id, me: res.me, access: acc, roleLabel: label });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      if (evt === "SIGNED_OUT") load(null);
      else if (evt === "SIGNED_IN" || evt === "USER_UPDATED") load(s);
      else setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const can = useCallback(
    (module: string, edit = false) => access.some((a) => a.module_key === module && (edit ? a.can_edit : a.can_view)),
    [access],
  );

  const value: Ctx = useMemo(() => ({
    ready, session, me, roleLabel, access, can, error,
    isSuper: me?.role_key === "super_admin",
    mustChangePassword: needsPasswordChange(session),
    reload: async () => { const { data } = await supabase.auth.getSession(); await load(data.session); },
    signOut: async () => { writeCache(null); await supabase.auth.signOut(); },
  }), [ready, session, me, roleLabel, access, can, error, load]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession hors SessionProvider");
  return c;
}
