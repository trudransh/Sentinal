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
            fontSize: "0.7rem",
            opacity: 0.6,
            fontFamily: "inherit",
          }}
          title={publicKey.toBase58()}
        >
          owner: {short(publicKey.toBase58())}
        </span>
      ) : (
        <span style={{ fontSize: "0.7rem", opacity: 0.5 }}>
          [DEMO MODE — connect a Ledger-backed wallet for production]
        </span>
      )}
      <WalletMultiButton style={{ fontSize: "0.8rem", height: "2rem" }} />
    </div>
  );
}

function short(s: string): string {
  return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}
