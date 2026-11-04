import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "RH360 — NotionCall",
  description: "Congés, documents, pointage, stats RDV et paie",
  // Doublon volontaire de l'en-tête X-Robots-Tag (next.config.mjs).
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/* Thème avant le premier affichage (pas de flash blanc) : choix mémorisé, sinon réglage du système */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("rh360.theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}` }} />
      </head>
      <body>
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
