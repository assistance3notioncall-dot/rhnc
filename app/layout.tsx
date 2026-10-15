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
    <html lang="fr">
      <body>
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
