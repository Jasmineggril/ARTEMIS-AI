import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchRiskWeather, ConnectorError } from "../../server/connectors/open-meteo";

const OK_BODY = {
  current: { time: "2026-11-17T15:00", temperature_2m: 33.2, relative_humidity_2m: 41, wind_speed_10m: 9.4 },
  hourly: { time: Array.from({ length: 96 }, (_, i) => new Date(Date.UTC(2026, 10, 14, i)).toISOString().slice(0, 16)), precipitation: Array(96).fill(0) },
  utc_offset_seconds: 0,
};
const res = (status: number, body: unknown = null, retryAfter?: string) => ({
  ok: status === 200, status, json: async () => body, headers: { get: (h: string) => (h.toLowerCase() === "retry-after" ? retryAfter ?? null : null) },
});

test("Open-Meteo: 429 then success is retried, honouring Retry-After (capped)", async () => {
  const waits: number[] = [];
  const seq = [res(429, null, "2"), res(200, OK_BODY)];
  let i = 0;
  const w = await fetchRiskWeather(-1.05, -53.52, (async () => seq[i++]) as any, 1000, 3, async (ms) => { waits.push(ms); });
  assert.equal(w.temperature, 33.2);
  assert.deepEqual(waits, [2000]);
});

test("Open-Meteo: persistent 429 fails with a clear message after N attempts; 400 is not retried", async () => {
  let calls = 0;
  await assert.rejects(
    fetchRiskWeather(0, 0, (async () => { calls++; return res(429); }) as any, 1000, 3, async () => {}),
    (e: unknown) => e instanceof ConnectorError && /limitou as consultas \(HTTP 429.*Tentativas: 3/.test(e.message),
  );
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(fetchRiskWeather(0, 0, (async () => { calls++; return res(400); }) as any, 1000, 3, async () => {}), /HTTP 400/);
  assert.equal(calls, 1);
});

test("Open-Meteo: timeout is retried and reported", async () => {
  let calls = 0;
  const hang = (_u: string, init: { signal: AbortSignal }) => new Promise((_, rej) => { calls++; init.signal.addEventListener("abort", () => rej(new Error("abort"))); });
  await assert.rejects(fetchRiskWeather(0, 0, hang as any, 20, 2, async () => {}), /sem resposta no tempo limite\. Tentativas: 2/);
  assert.equal(calls, 2);
});
