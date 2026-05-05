"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

// B2: connect-wallet pill in the header. Phantom by default; Ledger comes
// through Phantom's hardware-wallet pass-through, so no extra integration
// needed for the docs/TRUST_MODEL.md "owner key on hardware" requirement.
export default function WalletControls() {
  const { connected, publicKey } = useWallet();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      {connected && publicKey ? (
        <span
          style={{
            fontSize: "0.68rem",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }}
          title={publicKey.toBase58()}
        >
          owner: {short(publicKey.toBase58())}
        </span>
      ) : (
        <span style={{
          fontSize: "0.68rem",
          color: "var(--accent-yellow)",
          background: "var(--accent-yellow-dim)",
          padding: "0.15rem 0.5rem",
          borderRadius: "9999px",
          border: "1px solid rgba(251, 191, 36, 0.2)",
        }}>
          DEMO MODE
        </span>
      )}
      <WalletMultiButton />
    </div>
  );
}

function short(s: string): string {
  return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}
