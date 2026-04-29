import { Suspense } from "react";
import LiveActivity from "./components/live-activity";
import EscalationQueue from "./components/escalation-queue";
import PolicyEditor from "./components/policy-editor";
import BalanceWidget from "./components/balance-widget";
import AgentSpendChart from "./components/agent-spend-chart";
import WalletControls from "./components/wallet-controls";
import EscalationApprover from "./components/escalation-approver";

const DEFAULT_AGENT =
  process.env.NEXT_PUBLIC_DEMO_AGENT ?? "AGENTPubKEy11111111111111111111111111111111";

export default function Page() {
  return (
    <main className="sentinel-main">
      <header className="sentinel-header">
        <div className="sentinel-logo">
          <div className="sentinel-logo-icon">S</div>
          <div>
            <h1>Sentinel</h1>
            <p className="tagline">
              Programmable transaction firewall for autonomous Solana agents
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span className="network-badge">⬡ devnet</span>
          <WalletControls />
        </div>
      </header>

      <EscalationApprover programId={process.env.SENTINEL_REGISTRY_PROGRAM_ID} />

      <div className="dashboard-grid">
        {/* Row 1: Balance + Spend side by side */}
        <section className="card">
          <h2 className="card-header">
            <span className="dot" />
            Wallet Balance
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: "0.65rem", color: "var(--text-muted)" }}>
              {short(DEFAULT_AGENT)}
            </span>
          </h2>
          <Suspense fallback={<div style={{ opacity: 0.4, fontSize: "0.8rem" }}>loading…</div>}>
            <BalanceWidget address={DEFAULT_AGENT} />
          </Suspense>
        </section>

        <section className="card">
          <h2 className="card-header">
            Agent Spend
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: "0.65rem", color: "var(--text-muted)" }}>
              7d window
            </span>
          </h2>
          <AgentSpendChart address={DEFAULT_AGENT} />
        </section>

        {/* Row 2: Live Activity — full width */}
        <section className="card span-full">
          <h2 className="card-header">
            <span className="dot" />
            Live Activity
          </h2>
          <LiveActivity />
        </section>

        {/* Row 3: Escalations + Policy Editor side by side */}
        <section className="card">
          <h2 className="card-header">
            Escalation Queue
          </h2>
          <EscalationQueue />
        </section>

        <section className="card">
          <h2 className="card-header">
            Policy Editor
          </h2>
          <PolicyEditor />
        </section>
      </div>
    </main>
  );
}

function short(s: string) {
  return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}
