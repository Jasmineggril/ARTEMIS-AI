/**
 * Haines index for a point from Open-Meteo PRESSURE-LEVEL model data (GFS family) at 18 UTC.
 * Model data, not radiosonde observations — labelled as such. When the vertical data is not
 * available (API error, quota, missing level) the result is "indisponivel" with the reason;
 * no surface value is ever substituted.
 */
import { haines, hainesVariant, type PressureLevels } from "@shared/haines";

export type FetchJson = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
const cache = new Map<string, { at: number; value: unknown }>();

export async function hainesForPoint(lat: number, lng: number, elevationM: number | null, opts: { fetchJson?: FetchJson; now?: Date } = {}) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3 * 3_600_000) return hit.value as Awaited<ReturnType<typeof compute>>;
  const value = await compute(lat, lng, elevationM, opts);
  if (value.status === "ok") cache.set(key, { at: Date.now(), value });
  return value;
}

async function compute(lat: number, lng: number, elevationM: number | null, opts: { fetchJson?: FetchJson; now?: Date }) {
  const base = { source: "Open-Meteo — níveis de pressão (modelo numérico), 18 UTC", nature: "estimado_modelo", method: "Haines (1988), variante pela elevação" };
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(4)); url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set("hourly", "temperature_950hPa,temperature_850hPa,dew_point_850hPa,temperature_700hPa,dew_point_700hPa,temperature_500hPa");
  url.searchParams.set("forecast_days", "2"); url.searchParams.set("past_days", "1"); url.searchParams.set("timezone", "UTC");
  try {
    const f = opts.fetchJson ?? ((u: string) => fetch(u, { signal: AbortSignal.timeout(15_000) }) as any);
    const r = await f(url.toString());
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.hourly?.time) return { ...base, status: "indisponivel" as const, reason: j?.reason ? `Open-Meteo: ${j.reason}` : `Open-Meteo respondeu HTTP ${r.status}.` };
    const elev = elevationM ?? (Number.isFinite(j.elevation) ? j.elevation : null);
    if (elev == null) return { ...base, status: "indisponivel" as const, reason: "Elevação do local desconhecida (necessária para escolher a variante)." };
    const variant = hainesVariant(elev);
    const now = opts.now ?? new Date();
    const days = [0, 1].map((k) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + k, 18)).toISOString().slice(0, 13) + ":00");
    const values = days.map((t) => {
      const i = (j.hourly.time as string[]).indexOf(t);
      if (i < 0) return { at: t + "Z", result: null };
      const H = j.hourly, L: PressureLevels = { t950: H.temperature_950hPa?.[i], t850: H.temperature_850hPa?.[i], td850: H.dew_point_850hPa?.[i], t700: H.temperature_700hPa?.[i], td700: H.dew_point_700hPa?.[i], t500: H.temperature_500hPa?.[i] };
      return { at: t + "Z", levels: L, result: haines(L, variant) };
    });
    if (values.every((v) => !v.result)) return { ...base, status: "indisponivel" as const, reason: `Níveis de pressão necessários para a variante ${variant} ausentes na resposta.` };
    return { ...base, status: "ok" as const, elevationM: elev, variant, values,
      note: "Índice de estabilidade e secura da baixa troposfera: indica potencial de crescimento de um incêndio já iniciado, não risco de ignição. Dados de modelo, não de radiossondagem." };
  } catch (e) {
    return { ...base, status: "indisponivel" as const, reason: `Falha ao consultar dados verticais (${e instanceof Error ? e.message : String(e)}).` };
  }
}
