import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CoachBook UK", template: "%s · CoachBook UK" },
  description: "Booking and payments for UK football coaches, with an AI receptionist.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
