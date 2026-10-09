"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Loading } from "@/components/ui";

export default function Home() {
  const { ready, session, access, mustChangePassword } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace("/login");
    else if (mustChangePassword) router.replace("/mot-de-passe");
    else router.replace("/" + (access[0]?.module_key ?? "profil"));
  }, [ready, session, access, mustChangePassword, router]);
  return <Loading />;
}
