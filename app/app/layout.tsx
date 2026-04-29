import type { ReactNode } from "react";
import type { Metadata } from "next";
import SentinelWalletProvider from "./components/wallet-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sentinel — Solana Transaction Firewall",
  description:
    "Programmable transaction firewall for autonomous Solana agents. Define policies, enforce caps, and approve escalations in real-time.",
  keywords: ["solana", "firewall", "agent", "policy", "sentinel", "transaction"],
  authors: [{ name: "Sentinel" }],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body>
        <SentinelWalletProvider>{children}</SentinelWalletProvider>
      </body>
    </html>
  );
}
