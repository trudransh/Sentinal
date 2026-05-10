import { Suspense } from "react";
import LiveActivity from "./components/live-activity";
import EscalationQueue from "./components/escalation-queue";
import PolicyEditor from "./components/policy-editor";
import BalanceWidget from "./components/balance-widget";
import AgentSpendChart from "./components/agent-spend-chart";
import EscalationApprover from "./components/escalation-approver";
import SquadsConnect from "./components/squads-connect";
import AppShell from "./components/app-shell";

const DEFAULT_AGENT =
  process.env.NEXT_PUBLIC_DEMO_AGENT ?? "AGENTPubKEy11111111111111111111111111111111";

export default function Page() {
  return (
    <AppShell defaultAgent={DEFAULT_AGENT}>
      <header className="sentinel-header">
        <div>
          <h1>
            Agent treasury <span className="gradient-text">overview</span>
          </h1>
          <p className="tagline">
            Programmable policy primitive · live on Solana devnet
          </p>
        </div>
      </header>

      <EscalationApprover programId={process.env.SENTINEL_REGISTRY_PROGRAM_ID} />

      <div className="dashboard-grid">
        <section className="card" id="dashboard">
          <h2 className="card-header">
            <span className="dot" />
            Wallet balance
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: "0.65rem", color: "var(--text-muted)" }}>
              {short(DEFAULT_AGENT)}
            </span>
          </h2>
          <Suspense fallback={<BalanceSkeleton />}>
            <BalanceWidget address={DEFAULT_AGENT} />
          </Suspense>
        </section>

        <section className="card">
          <h2 className="card-header">
            Agent spend
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: "0.65rem", color: "var(--text-muted)" }}>
              7d window
            </span>
          </h2>
          <AgentSpendChart address={DEFAULT_AGENT} />
        </section>

        <section className="card span-full" id="activity">
          <h2 className="card-header">
            <span className="dot" />
            Live activity
          </h2>
          <LiveActivity />
        </section>

        <section className="card">
          <h2 className="card-header">Escalation queue</h2>
          <EscalationQueue />
        </section>

        <section className="card" id="policies">
          <h2 className="card-header">Policy editor</h2>
          <PolicyEditor />
        </section>

        <section className="card span-full">
          <h2 className="card-header">
            Squads multisig owner
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: "0.65rem", color: "var(--text-muted)" }}>
              policy.owner = vault PDA
            </span>
          </h2>
          <SquadsConnect
            programId={process.env.SENTINEL_REGISTRY_PROGRAM_ID}
            defaultAgent={DEFAULT_AGENT}
          />
        </section>
      </div>
    </AppShell>
  );
}

function BalanceSkeleton() {
  return (
    <div className="skeleton-stack">
      <div className="skeleton skeleton-row med" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row short" />
    </div>
  );
}

function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}
