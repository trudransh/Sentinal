import express from "express";
import { x402Protect } from "./server-middleware.js";

const PORT = Number(process.env.DEMO_PORT ?? 4002);
const RECEIVER =
  process.env.X402_RECEIVING_ADDRESS ?? "DpfxWR9oBJeDL8vf9nHVGUK4BKDcQfGUmo5Tpah9joMN";
const BLOCKED_RECEIVER =
  process.env.X402_BLOCKED_ADDRESS ?? "2NGLZrjxK1FN8HkEawQuGap8MyMbnxE686BBDvv684DD";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get(
  "/cheap",
  x402Protect({
    receivingAddress: RECEIVER,
    pricePerCall: { token: "USDC", amount: 0.001 },
    description: "tiny demo endpoint, always-on",
  }),
  (_req, res) => {
    res.json({ data: "cheap data", price: "0.001 USDC" });
  },
);

app.get(
  "/expensive",
  x402Protect({
    receivingAddress: RECEIVER,
    pricePerCall: { token: "USDC", amount: 5 },
    description: "expensive demo endpoint - escalates under medium policy",
  }),
  (_req, res) => {
    res.json({ data: "premium data", price: "5 USDC" });
  },
);

app.get(
  "/blocked",
  x402Protect({
    receivingAddress: BLOCKED_RECEIVER,
    pricePerCall: { token: "USDC", amount: 0.001 },
    description: "destination on agent denylist - must be denied",
  }),
  (_req, res) => {
    res.json({ data: "should never reach here" });
  },
);

app.listen(PORT, () => {
  console.log(`demo-server listening on http://localhost:${PORT}`);
  console.log("  GET /cheap     (0.001 USDC, allow under medium)");
  console.log("  GET /expensive (5 USDC, escalate under medium)");
  console.log("  GET /blocked   (denylist destination, deny)");
});
