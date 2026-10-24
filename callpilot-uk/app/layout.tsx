import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CallPilot UK | AI Receptionist Control Centre",
  description: "Manage AI receptionists, client businesses and call enquiries.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
