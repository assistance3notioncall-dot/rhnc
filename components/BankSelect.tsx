"use client";
import { useState } from "react";

// Banques utilisées dans l'entreprise (mêmes noms que dans Suivi Administratif).
export const BANKS = [
  "Attijariwafa Bank", "CIH Bank", "Barid Bank", "Banque Populaire", "Bank of Africa",
  "Crédit du Maroc", "Crédit Agricole du Maroc", "Saham Bank", "Société Générale",
];

/** Liste déroulante des banques, avec « Autre » pour saisir un nom libre. */
export function BankSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [picked, setOther] = useState(false);
  // « Autre » si choisi, ou si la valeur chargée n'est pas dans la liste
  const other = picked || (!!value && !BANKS.includes(value));
  const sel = other ? "__autre" : value;
  return (
    <div className="flex gap-2">
      <select className="inp" value={sel} onChange={(e) => {
        const v = e.target.value;
        if (v === "__autre") { setOther(true); onChange(""); } else { setOther(false); onChange(v); }
      }}>
        <option value="">—</option>
        {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
        <option value="__autre">Autre…</option>
      </select>
      {other && <input className="inp" placeholder="Nom de la banque" value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}
