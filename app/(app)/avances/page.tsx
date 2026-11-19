"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Guard } from "@/components/Guard";
import { PageHead } from "@/components/ui";
import { AdvancesPanel } from "@/components/Advances";
import { monthStart } from "@/lib/format";

type Person = { id: string; first_name: string; last_name: string };

/** Avances : la RH saisit (nom + montant), l'administration confirme, puis « Prise » = retenue sur la paie du mois. */
export default function Avances() {
  const { isSuper } = useSession();
  const [month, setMonth] = useState(monthStart());
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    supabase.from("profiles").select("id,first_name,last_name").eq("status", "actif").eq("in_payroll", true).order("first_name")
      .then(({ data }) => setPeople((data as Person[]) ?? []));
  }, []);
  return (
    <Guard module="avances">
      <PageHead title="Avances" sub="Saisie par la RH · confirmation par l'administration · retenue sur la paie une fois prise.">
        <input type="month" className="inp w-auto" value={month.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value + "-01")} />
      </PageHead>
      <div className="card p-0">
        <AdvancesPanel month={month} people={people} isSuper={isSuper} canAdd onChanged={() => {}} />
      </div>
    </Guard>
  );
}
