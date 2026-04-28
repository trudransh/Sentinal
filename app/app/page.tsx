import { Suspense } from "react";
import LiveActivity from "./components/live-activity";
import EscalationQueue from "./components/escalation-queue";
import PolicyEditor from "./components/policy-editor";
import BalanceWidget from "./components/balance-widget";
import WalletControls from "./components/wallet-controls";
import EscalationApprover from "./components/escalation-approver";

const DEFAULT_AGENT =
  process.env.NEXT_PUBLIC_DEMO_AGENT ?? "AGENTPubKEy11111111111111111111111111111111";

export default function Page() {
  return (
    <main style={{ padding: "1.5rem", maxWidth: 1280, margin: "0 auto" }}>
      <header
        style={{
          marginBottom: "1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Sentinel</h1>
          <p style={{ margin: "0.25rem 0 0 0", opacity: 0.7, fontSize: "0.85rem" }}>
            Programmable transaction firewall for autonomous Solana agents
          </p>
        </div>
        <WalletControls />
      </header>
      <EscalationApprover programId={process.env.NEXT_PUBLIC_SENTINEL_PROGRAM_ID} />

      <section style={panel}>
        <h2 style={panelHeader}>Wallet balance ({short(DEFAULT_AGENT)})</h2>
        <Suspense fallback={<div>loading…</div>}>
          <BalanceWidget address={DEFAULT_AGENT} />
        </Suspense>
      </section>

      <section style={panel}>
        <h2 style={panelHeader}>Live activity</h2>
        <LiveActivity />
      </section>

      <section style={panel}>
        <h2 style={panelHeader}>Escalation queue</h2>
        <EscalationQueue />
      </section>

      <section style={panel}>
        <h2 style={panelHeader}>Policy editor</h2>
        <PolicyEditor />
      </section>
    </main>
  );
}

const panel: React.CSSProperties = {
  background: "#13171c",
  border: "1px solid #1f242c",
  borderRadius: 6,
  padding: "1rem",
  marginBottom: "1rem",
};

const panelHeader: React.CSSProperties = {
  fontSize: "0.85rem",
  fontWeight: 600,
  margin: "0 0 0.75rem 0",
  letterSpacing: "0.04em",
  opacity: 0.85,
  textTransform: "uppercase",
};

function short(s: string) {
  return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}
