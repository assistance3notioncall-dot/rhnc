export const dh = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)) + " DH";
export const num = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d }).format(Number(n));
export const dfr = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("fr-FR") : "—");
export const dtfr = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
export const monthLabel = (s: string) =>
  new Date(s + (s.length === 7 ? "-01" : "") + "T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
export const ymd = (d: Date) => {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};
export const monthStart = (d = new Date()) => ymd(new Date(d.getFullYear(), d.getMonth(), 1));
export const fullName = (p: { first_name?: string | null; last_name?: string | null } | null | undefined) =>
  p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : "—";
export const initials = (p: { first_name?: string | null; last_name?: string | null } | null | undefined) =>
  ((p?.first_name?.[0] ?? "") + (p?.last_name?.[0] ?? "")).toUpperCase() || "?";

export const STATUS: Record<string, { label: string; cls: string }> = {
  brouillon: { label: "Brouillon", cls: "bg-gray2-l text-gray2" },
  envoyee: { label: "Envoyée", cls: "bg-warn-l text-warn" },
  valid_mgr: { label: "Validée manager", cls: "bg-pri-l text-pri-d" },
  valid_rh: { label: "Validée RH", cls: "bg-teal2-l text-teal2" },
  traitee: { label: "Traitée", cls: "bg-ok-l text-ok" },
  refusee: { label: "Refusée", cls: "bg-err-l text-err" },
  annulee: { label: "Annulée", cls: "bg-gray2-l text-mut" },
  en_attente: { label: "En attente", cls: "bg-warn-l text-warn" },
  appliquee: { label: "Appliquée", cls: "bg-ok-l text-ok" },
  ouverte: { label: "Ouverte", cls: "bg-gray2-l text-gray2" },
  calculee: { label: "Calculée", cls: "bg-pri-l text-pri-d" },
  validee: { label: "Validée", cls: "bg-ok-l text-ok" },
  cloturee: { label: "Clôturée", cls: "bg-vio-l text-vio" },
  actif: { label: "Actif", cls: "bg-ok-l text-ok" },
  bloque: { label: "Bloqué", cls: "bg-err-l text-err" },
  sans_compte: { label: "Sans accès", cls: "bg-gray2-l text-gray2" },
};
export const KIND: Record<string, string> = {
  absence: "Congé / absence", document: "Document", avance: "Avance sur salaire",
  reclamation: "Réclamation", maj_profil: "Mise à jour du profil",
};

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(";"), ...rows.map((r) => cols.map((c) => esc(r[c])).join(";"))].join("\n");
}
export function downloadCSV(name: string, rows: Record<string, unknown>[]) {
  const blob = new Blob(["﻿" + toCSV(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
