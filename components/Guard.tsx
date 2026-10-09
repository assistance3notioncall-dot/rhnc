"use client";
import { useSession } from "@/lib/session";

/** Affiche la page seulement si le rôle a le droit "voir" sur le module. */
export function Guard({ module, children }: { module: string; children: React.ReactNode }) {
  const { can } = useSession();
  if (!can(module))
    return (
      <div className="card mx-auto mt-10 max-w-md text-center">
        <h2>Accès non autorisé</h2>
        <p className="mut mt-2">Ce module n&apos;est pas activé pour votre rôle. Contactez le super admin.</p>
      </div>
    );
  return <>{children}</>;
}
