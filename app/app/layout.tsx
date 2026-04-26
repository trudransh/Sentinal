import type { ReactNode } from "react";

export const metadata = {
  title: "Sentinel — Solana transaction firewall",
  description:
    "Programmable transaction firewall for autonomous Solana agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          background: "#0b0d10",
          color: "#e6e9ef",
        }}
      >
        {children}
      </body>
    </html>
  );
}
