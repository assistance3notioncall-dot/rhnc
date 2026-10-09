"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Logo } from "@/components/Logo";
import { Loading } from "@/components/ui";
import { dtfr, fullName, initials } from "@/lib/format";

const ICON: Record<string, string> = {
  accueil: "⌂", demandes: "✎", calendrier: "▦", documents: "▤", mesrdv: "★", profil: "◉",
  validations: "✓", pointage: "⏱", salaries: "☰", stats: "▲", paie: "₪", rapports: "◧", parametres: "⚙", admin: "⛨",
};
const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Mon espace", keys: ["accueil", "demandes", "calendrier", "documents", "mesrdv", "profil"] },
  { title: "Gestion", keys: ["validations", "pointage", "salaries", "stats", "paie", "rapports"] },
  { title: "Administration", keys: ["parametres", "admin"] },
];
type Notif = { id: number; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, session, me, roleLabel, access, mustChangePassword, signOut, can, error, reload } = useSession();
  const router = useRouter();
  const path = usePathname();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace("/login");
    else if (mustChangePassword) router.replace("/mot-de-passe");
  }, [ready, session, mustChangePassword, router]);

  useEffect(() => {
    if (!me) return;
    const load = async () => {
      const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(15);
      setNotifs((data as Notif[]) ?? []);
      if (can("validations")) {
        const { count } = await supabase.from("requests").select("id", { count: "exact", head: true })
          .in("status", ["envoyee", "valid_mgr", "valid_rh"]).neq("profile_id", me.id);
        setPending(count ?? 0);
      }
    };
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [me, can, path]);

  if (!ready || !session) return <Loading />;
  // Sans ça, un échec de chargement laissait un <Loading /> infini : aucune
  // indication de ce qui n'allait pas, ni moyen de réessayer.
  if (error || !me)
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="card w-full max-w-md">
          <h1 className="mb-1">Chargement impossible</h1>
          <p className="mut mb-5">
            {error ?? "Votre fiche salarié est introuvable. Demandez à un super admin de vérifier votre accès."}
          </p>
          <div className="flex gap-2">
            <button className="btn-pri" onClick={() => reload()}>Réessayer</button>
            <button className="btn" onClick={() => signOut()}>Se déconnecter</button>
          </div>
        </div>
      </div>
    );
  const unread = notifs.filter((n) => !n.read_at).length;
  const markAll = async () => {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    setNotifs((x) => x.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  };

  const nav = (
    <nav>
      {GROUPS.map((g) => {
        const items = g.keys.map((k) => access.find((a) => a.module_key === k)).filter(Boolean);
        if (!items.length) return null;
        return (
          <div key={g.title}>
            <div className="px-3 pb-1.5 pt-3 text-[11px] uppercase tracking-wider text-mut">{g.title}</div>
            {items.map((a) => {
              const on = path === "/" + a!.module_key || path.startsWith("/" + a!.module_key + "/");
              return (
                <Link key={a!.module_key} href={"/" + a!.module_key} onClick={() => setMenu(false)}
                  className={`mb-0.5 flex items-center gap-2.5 rounded-[9px] px-3 py-2 font-medium ${on ? "bg-pri-l text-pri-d" : "text-gray2 hover:bg-gray2-l"}`}>
                  <span className="w-[18px] text-center">{ICON[a!.module_key] ?? "•"}</span>
                  {a!.label}
                  {a!.module_key === "validations" && pending > 0 && (
                    <span className="ml-auto rounded-full bg-err px-1.5 text-[11px] font-semibold text-white">{pending}</span>
                  )}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className={`${menu ? "fixed inset-0 z-40 flex" : "hidden"} flex-col gap-4 overflow-y-auto border-r border-line bg-white px-3 py-[18px] md:sticky md:top-0 md:flex md:h-screen`}>
        <div className="flex items-center justify-between px-2">
          <Logo />
          <button className="btn btn-sm md:hidden" onClick={() => setMenu(false)}>✕</button>
        </div>
        {nav}
        <div className="mt-auto rounded-[10px] bg-gray2-l p-3 text-[12.5px]">
          <div className="font-semibold">{fullName(me)}</div>
          <div className="mut">{roleLabel} · @{me.username}</div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-white px-4 py-3 md:px-6">
          <button className="btn btn-sm md:hidden" onClick={() => setMenu(true)}>☰</button>
          <div className="ml-auto flex items-center gap-2.5">
            <div className="relative">
              <button className="relative grid h-[38px] w-[38px] place-items-center rounded-[9px] border border-line bg-white" onClick={() => setOpen(!open)} aria-label="Notifications">
                🔔{unread > 0 && <b className="absolute right-[7px] top-[6px] h-2 w-2 rounded-full bg-err" />}
              </button>
              {open && (
                <div className="card absolute right-0 top-11 z-20 w-80 p-0">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <h3>Notifications</h3>
                    {unread > 0 && <button className="text-[12.5px] text-pri" onClick={markAll}>Tout marquer lu</button>}
                  </div>
                  <div className="max-h-96 overflow-auto">
                    {notifs.length === 0 && <div className="mut p-4">Rien de nouveau.</div>}
                    {notifs.map((n) => (
                      <Link key={n.id} href={n.link ?? "#"} onClick={() => setOpen(false)} className={`block border-b border-line px-4 py-3 hover:bg-gray2-l ${n.read_at ? "" : "bg-pri-l/40"}`}>
                        <div className="font-medium">{n.title}</div>
                        {n.body && <div className="mut text-[12.5px]">{n.body}</div>}
                        <div className="mut text-[11.5px]">{dtfr(n.created_at)}</div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="grid h-[34px] w-[34px] place-items-center rounded-full bg-pri-l text-[12.5px] font-bold text-pri-d">{initials(me)}</div>
            <button className="btn btn-sm" onClick={async () => { await signOut(); router.replace("/login"); }}>Déconnexion</button>
          </div>
        </header>
        <main className="w-full max-w-[1240px] p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
