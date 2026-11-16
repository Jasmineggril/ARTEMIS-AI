/**
 * Sisfogo connector status for signed-in users; manual sync for platform administrators.
 * The integration is shown as operational only after a COMPLETE real synchronisation.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Landmark, RefreshCw, CheckCircle2, AlertTriangle, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { useAuthStatus } from "@/hooks/use-auth";
import { useState } from "react";

interface Run {
  id: number; startedAt: string; finishedAt: string | null; status: "em_execucao" | "sucesso" | "falha"; trigger: string | null;
  params: { mode?: string } | null; pagesRead: number; recordsRead: number; recordsInserted: number; recordsUpdated: number;
  recordsRectified: number; recordsUnchanged: number; recordsRejected: number; recordsUnavailable: number;
  rejectionReasons: Record<string, number> | null; progress: { stoppedBecause?: string; note?: string; lastPage?: number; totalPages?: number } | null; error: string | null;
}
interface Status {
  source: { name: string; url: string | null; status: string; integrationStatus: string | null; licence: string | null };
  operational: boolean; lastCompleteAt: string | null; lastSuccessAt: string | null; running: boolean;
  counts: { total: number; available: number; rectified: number; withCoords: number; firstStart: string | null; lastStart: string | null };
  runs: Run[];
}

const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "dd/MM/yyyy HH:mm") : "—");
const STOP: Record<string, string> = {
  fim_da_lista: "leu todas as páginas", sem_novidades: "parou: páginas sem novidades", limite_de_paginas: "parou no limite de páginas",
  limite_de_registros: "parou no limite de registros", erro: "interrompida por erro",
};
const TRIGGER: Record<string, string> = { cli: "linha de comando", agendado: "agendada", manual: "manual (painel)", teste: "teste" };

export function SisfogoSyncPanel() {
  const { data: user } = useAuthStatus();
  const isPlatformAdmin = user?.platformRole === "platform_admin";
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const { data, error, isLoading } = useQuery<Status>({
    queryKey: ["/api/connectors/sisfogo/status"],
    queryFn: () => api("GET", "/api/connectors/sisfogo/status"),
    refetchInterval: (q) => (q.state.data?.running ? 4000 : false),
  });
  const sync = useMutation({
    mutationFn: (mode: "incremental" | "completa") => api<{ runId: number; message: string }>("POST", "/api/admin/connectors/sisfogo/sync", { mode }),
    onSuccess: (r) => { setMsg({ kind: "ok", text: `${r.message} (execução #${r.runId})` }); qc.invalidateQueries({ queryKey: ["/api/connectors/sisfogo/status"] }); },
    onError: (e) => setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Não foi possível iniciar a sincronização." }),
  });

  if (isLoading) return <section className="mt-8 bg-card border rounded-2xl p-5 h-40 animate-pulse" aria-busy="true" />;
  if (error || !data) {
    return <section className="mt-8 bg-card border rounded-2xl p-5 text-sm text-muted-foreground">Estado do conector Sisfogo indisponível no momento.</section>;
  }
  const last = data.runs[0];

  return (
    <section className="mt-8 bg-card border rounded-2xl p-5" aria-labelledby="sisfogo-sync-title" data-testid="panel-sisfogo-sync">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sisfogo-sync-title" className="font-semibold flex items-center gap-2"><Landmark className="w-5 h-5 text-primary" aria-hidden />{data.source.name}</h2>
          <p className="text-xs text-muted-foreground mt-1">Leitura da API pública de ROIs finalizados. A ARTEMIS AI não envia nem altera dados no Sisfogo.</p>
        </div>
        {data.running ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 bg-blue-50 text-blue-800 border border-blue-200"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />Sincronizando…</span>
        ) : data.operational ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden />Operacional</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 bg-amber-50 text-amber-900 border border-amber-200"><Clock className="w-3.5 h-3.5" aria-hidden />Aguardando primeira sincronização completa</span>
        )}
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
        <div className="rounded-xl bg-muted/50 p-3"><dt className="text-xs text-muted-foreground">ROIs armazenados</dt><dd className="text-xl font-bold tabular-nums">{data.counts.total.toLocaleString("pt-BR")}</dd>
          <dd className="text-[11px] text-muted-foreground">{data.counts.available.toLocaleString("pt-BR")} publicados agora · {data.counts.rectified} alterado(s) desde a 1ª captura</dd></div>
        <div className="rounded-xl bg-muted/50 p-3"><dt className="text-xs text-muted-foreground">Última sincronização completa</dt><dd className="font-semibold">{when(data.lastCompleteAt)}</dd></div>
        <div className="rounded-xl bg-muted/50 p-3"><dt className="text-xs text-muted-foreground">Última execução bem-sucedida</dt><dd className="font-semibold">{when(data.lastSuccessAt)}</dd></div>
        <div className="rounded-xl bg-muted/50 p-3"><dt className="text-xs text-muted-foreground">Período dos registros</dt>
          <dd className="font-semibold">{data.counts.firstStart ? `${format(new Date(data.counts.firstStart), "dd/MM/yyyy")} – ${format(new Date(data.counts.lastStart!), "dd/MM/yyyy")}` : "—"}</dd></div>
      </dl>

      {last?.status === "falha" && (
        <p role="alert" className="mt-4 text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-950 p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          <span>A última execução ({when(last.startedAt)}) não terminou: {last.error ?? "erro não informado"}
            {" "}Os dados já armazenados continuam disponíveis; o Sisfogo pode estar temporariamente fora do ar.</span>
        </p>
      )}
      {last?.progress?.note && <p className="mt-3 text-xs text-amber-900">{last.progress.note}</p>}

      {isPlatformAdmin && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={data.running || sync.isPending} onClick={() => sync.mutate("incremental")}>
            <RefreshCw className="w-4 h-4 mr-1" aria-hidden />Buscar novos registros
          </Button>
          <Button size="sm" variant="outline" disabled={data.running || sync.isPending} onClick={() => sync.mutate("completa")}>Sincronização completa</Button>
          <span className="text-xs text-muted-foreground">Completa: lê todas as páginas (alguns minutos) e marca ROIs que deixaram de ser publicados.</span>
        </div>
      )}
      {msg && <p role="status" className={`mt-2 text-sm ${msg.kind === "ok" ? "text-emerald-800" : "text-red-700"}`}>{msg.text}</p>}

      <details className="mt-4" open={!data.operational}>
        <summary className="cursor-pointer text-sm font-medium">Histórico de sincronizações</summary>
        {data.runs.length === 0 ? <p className="text-sm text-muted-foreground mt-2">Nenhuma execução registrada.</p> : (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs">
              <caption className="sr-only">Últimas execuções da sincronização do Sisfogo</caption>
              <thead><tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2">Início</th><th className="pr-2">Tipo</th><th className="pr-2">Situação</th>
                <th className="pr-2 text-right">Lidos</th><th className="pr-2 text-right">Novos</th><th className="pr-2 text-right">Atualizados</th>
                <th className="pr-2 text-right">Retificados</th><th className="pr-2 text-right">Inválidos</th><th className="pr-2 text-right">Indisponíveis</th><th>Observação</th>
              </tr></thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{when(r.startedAt)}</td>
                    <td className="pr-2 whitespace-nowrap">{r.params?.mode ?? "—"} · {TRIGGER[r.trigger ?? ""] ?? r.trigger ?? "—"}</td>
                    <td className="pr-2 whitespace-nowrap">{r.status === "sucesso" ? "concluída" : r.status === "falha" ? "falhou" : "em andamento"}</td>
                    <td className="pr-2 text-right tabular-nums">{r.recordsRead}</td>
                    <td className="pr-2 text-right tabular-nums">{r.recordsInserted}</td>
                    <td className="pr-2 text-right tabular-nums">{r.recordsUpdated - r.recordsRectified}</td>
                    <td className="pr-2 text-right tabular-nums">{r.recordsRectified}</td>
                    <td className="pr-2 text-right tabular-nums" title={r.rejectionReasons ? Object.entries(r.rejectionReasons).map(([k, v]) => `${k}: ${v}`).join(", ") : undefined}>{r.recordsRejected}</td>
                    <td className="pr-2 text-right tabular-nums">{r.recordsUnavailable}</td>
                    <td className="max-w-[260px]">{r.status === "falha" ? r.error : STOP[r.progress?.stoppedBecause ?? ""] ?? (r.progress?.lastPage ? `página ${r.progress.lastPage}/${r.progress.totalPages ?? "?"}` : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
      {data.source.licence && <p className="text-[11px] text-muted-foreground mt-3">Uso: {data.source.licence}</p>}
    </section>
  );
}
