/**
 * Official Sisfogo (Ibama/Prevfogo) ROI records for the public lookup.
 * Separate from organisation imports and from INPE satellite hotspots.
 */
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Landmark } from "lucide-react";
import { api } from "@/lib/api";

interface SisfogoSummary {
  total: number;
  withArea: number;
  burnedAreaHa: number | null;
  firstDay: string | null;
  lastDay: string | null;
  byState: { state: string; n: number }[];
  recent: { roiNumber: string | null; startedOn: string | null; municipality: string | null; state: string | null; biome: string | null; burnedAreaHa: number | null }[];
  lastSyncAt: string | null;
  notice: string;
}

const day = (d: string | null) => (d ? format(new Date(`${d}T12:00:00`), "dd/MM/yyyy") : "—");

export function SisfogoPanel({ state, municipality, from, to }: { state?: string; municipality?: string; from?: string; to?: string }) {
  const q = new URLSearchParams(
    Object.entries({ state, municipality: municipality?.trim(), from, to }).filter(([, v]) => v) as [string, string][],
  ).toString();
  const { data, error } = useQuery<SisfogoSummary>({
    queryKey: ["/api/public/sisfogo/summary", q],
    queryFn: () => api("GET", `/api/public/sisfogo/summary?${q}`),
  });
  if (error || !data) return null;

  return (
    <section className="bg-card border rounded-2xl p-5" aria-labelledby="sisfogo-title" data-testid="section-sisfogo">
      <h2 id="sisfogo-title" className="font-semibold flex items-center gap-2">
        <Landmark className="w-5 h-5 text-primary shrink-0" aria-hidden />
        Registros oficiais de incêndio — Sisfogo (Ibama/Prevfogo)
      </h2>
      <p className="text-xs text-muted-foreground mt-1">{data.notice}</p>
      <p className="text-xs text-muted-foreground">
        Última sincronização: {data.lastSyncAt ? format(new Date(data.lastSyncAt), "dd/MM/yyyy HH:mm") : "ainda não sincronizado"}
      </p>

      {!data.lastSyncAt ? (
        <p className="text-sm mt-3">A conexão com a API pública do Sisfogo está implementada e aguarda a primeira sincronização no servidor.</p>
      ) : data.total === 0 ? (
        <p className="text-sm mt-3">Nenhum registro do Sisfogo para este filtro.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <div className="rounded-xl bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground">Registros (ROI)</dt>
              <dd className="text-xl font-bold tabular-nums">{data.total.toLocaleString("pt-BR")}</dd>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground">Área queimada estimada</dt>
              <dd className="text-xl font-bold tabular-nums">{data.burnedAreaHa != null ? `${data.burnedAreaHa.toLocaleString("pt-BR")} ha` : "—"}</dd>
              <dd className="text-[11px] text-muted-foreground">em {data.withArea.toLocaleString("pt-BR")} registro(s) com área informada</dd>
            </div>
            <div className="rounded-xl bg-muted/50 p-3 col-span-2 md:col-span-1">
              <dt className="text-xs text-muted-foreground">Período dos registros</dt>
              <dd className="text-sm font-semibold">{day(data.firstDay)} – {day(data.lastDay)}</dd>
            </div>
          </dl>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <caption className="sr-only">Registros mais recentes do Sisfogo</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3">Início</th><th className="pr-3">Local</th><th className="pr-3">Bioma</th><th className="text-right">Área (ha)</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={r.roiNumber ?? i} className="border-t">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{day(r.startedOn)}</td>
                    <td className="pr-3">{[r.municipality, r.state].filter(Boolean).join("/") || "—"}</td>
                    <td className="pr-3">{r.biome ?? "—"}</td>
                    <td className="text-right tabular-nums">{r.burnedAreaHa != null ? r.burnedAreaHa.toLocaleString("pt-BR") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground mt-3">
        Fonte:{" "}
        <a className="underline" href="https://sisfogo.sistema.gov.br" target="_blank" rel="noopener noreferrer">Ibama/Prevfogo — Sisfogo</a>, API pública de ROI.
      </p>
    </section>
  );
}
