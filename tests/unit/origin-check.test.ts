import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { originCheck } from "../../server/security";

async function serve(trustProxy: number) {
  const app = express();
  app.set("trust proxy", trustProxy);
  app.use(originCheck());
  app.post("/api/x", (_req, res) => res.json({ ok: true }));
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const post = (headers: Record<string, string>) => fetch(base + "/api/x", { method: "POST", headers }).then((r) => r.status);
  return { post, close: () => new Promise((r) => srv.close(r)) };
}

test("origin check: same host passes; foreign origin blocked; X-Forwarded-Host only behind a trusted proxy", async () => {
  const direct = await serve(0);
  try {
    assert.equal(await direct.post({}), 200, "non-browser client");
    assert.equal(await direct.post({ Origin: "https://evil.example" }), 403);
    assert.equal(await direct.post({ Origin: "https://app.example", "X-Forwarded-Host": "app.example" }), 403, "untrusted proxy header ignored");
  } finally { await direct.close(); }
  const behind = await serve(1);
  try {
    assert.equal(await behind.post({ Origin: "https://app.example", "X-Forwarded-Host": "app.example" }), 200);
    assert.equal(await behind.post({ Origin: "https://evil.example", "X-Forwarded-Host": "app.example" }), 403);
  } finally { await behind.close(); }
});
