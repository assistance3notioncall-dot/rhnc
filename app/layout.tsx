import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = { title: "RH360 — NotionCall", description: "Congés, documents, pointage, stats RDV et paie" };

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
