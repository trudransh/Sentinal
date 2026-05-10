"use client";

import { useState, type ReactNode } from "react";
import WalletControls from "./wallet-controls";

// Sticky sidebar with brand + nav + wallet pill. Mobile: hamburger drawer.
// Routes are stubbed — only "Dashboard" is wired in this MVP. Other links
// remain client-side hash anchors to keep the visual shell honest about
// what's actually implemented.

type NavKey = "dashboard" | "policies" | "activity" | "settings";

interface NavLink {
  key: NavKey;
  label: string;
  href: string;
  badge?: string;
  icon: ReactNode;
}

const NAV_LINKS: NavLink[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "#dashboard",
    icon: <IconGrid />,
  },
  {
    key: "policies",
    label: "Policies",
    href: "#policies",
    icon: <IconShield />,
  },
  {
    key: "activity",
    label: "Activity",
    href: "#activity",
    icon: <IconActivity />,
  },
  {
    key: "settings",
    label: "Settings",
    href: "#settings",
    icon: <IconCog />,
  },
];

interface AppShellProps {
  children: ReactNode;
  defaultAgent: string;
}

export default function AppShell({ children, defaultAgent }: AppShellProps) {
  const [active, setActive] = useState<NavKey>("dashboard");
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <div
        className={`sidebar-backdrop ${drawerOpen ? "open" : ""}`}
        onClick={() => setDrawerOpen(false)}
      />
      <div className="app-shell">
        <aside className={`app-sidebar ${drawerOpen ? "open" : ""}`}>
          <div className="brand">
            <div className="sentinel-logo-icon">S</div>
            <div>
              <div className="brand-name">Sentinel</div>
              <div className="brand-sub">policy primitive</div>
            </div>
          </div>

          <div>
            <div className="nav-section-label">Workspace</div>
            <nav className="app-nav">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.key}
                  href={link.href}
                  className={`app-nav-item ${active === link.key ? "active" : ""}`}
                  onClick={() => {
                    setActive(link.key);
                    setDrawerOpen(false);
                  }}
                >
                  <span className="nav-icon">{link.icon}</span>
                  {link.label}
                  {link.badge && <span className="nav-badge">{link.badge}</span>}
                </a>
              ))}
            </nav>
          </div>

          <div className="sidebar-footer">
            <span className="network-badge" style={{ alignSelf: "flex-start" }}>
              ⬡ devnet
            </span>
            <div className="sidebar-wallet">
              <WalletControls />
            </div>
            <div className="footer-meta" title={defaultAgent}>
              agent · {short(defaultAgent)}
            </div>
          </div>
        </aside>

        <div>
          <div className="app-mobile-bar">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button
                aria-label="open menu"
                className="hamburger"
                onClick={() => setDrawerOpen(true)}
              >
                <IconMenu />
              </button>
              <span className="brand-name" style={{ fontSize: "0.95rem" }}>
                Sentinel
              </span>
            </div>
            <span className="network-badge">⬡ devnet</span>
          </div>
          <main className="app-content">{children}</main>
        </div>
      </div>
    </>
  );
}

function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

// ── Inline SVG icons (pixel-snapped, currentColor) ───────────────────

function IconGrid() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
      <path d="M8 1.5l5.5 2v4c0 3.5-2.5 6-5.5 7-3-1-5.5-3.5-5.5-7v-4l5.5-2z" />
      <path d="M5.5 8l1.8 1.8L10.5 6.5" />
    </svg>
  );
}

function IconActivity() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
      <path d="M1.5 8h3l2-5 3 10 2-5h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCog() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" width="16" height="16">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16">
      <path d="M2 4.5h12M2 8h12M2 11.5h12" strokeLinecap="round" />
    </svg>
  );
}
