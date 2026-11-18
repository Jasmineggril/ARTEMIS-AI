import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Timer } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuthStatus, hasRole } from "@/hooks/use-auth";
import { api } from "@/lib/api";

const SOURCES: [string, string][] = [["inpe", "Site do INPE (focos)"], ["sisfogo", "Sisfogo/Ibama"], ["meteorologia", "Previsão do tempo / meteorologia"], ["mapa", "Mapa ou imagem de satélite"], ["planilha", "Planilha ou anotações próprias"], ["outro", "Outra fonte"]];
const fmt = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`; };

/**
 * Proof of Value baseline: the evaluator times the SAME risk assessment done
 * WITHOUT the platform (by hand, with the usual sources). Compared later with
 * the time measured inside the platform for the analyses.
 */
export default function LinhaDeBase() {
  const { data: user } = useAuthStatus();
  const canRecord = hasRole(user, "analyst");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: areas = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ["/api/areas"] });
  const { data: rows = [] } = useQuery<{ id: number; durationMs: number; createdAt: string; sourcesConsulted: string[] }[]>({ queryKey: ["/api/pov/baseline"] });
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [stoppedMs, setStoppedMs] = useState<number | null>(null);
  const [areaId, setAreaId] = useState<string>("");
  const [sources, setSources] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const tick = useRef<number>();
  useEffect(() => () => window.clearInterval(tick.current), []);

  const start = () => { const now = new Date(); setStartedAt(now); setStoppedMs(null); setElapsed(0); tick.current = window.setInterval(() => setElapsed(Date.now() - now.getTime()), 1000); };
  const stop = () => { window.clearInterval(tick.current); setStoppedMs(Date.now() - startedAt!.getTime()); };
  async function save() {
    try {
      await api("POST", "/api/pov/baseline", { durationMs: stoppedMs, startedAt: startedAt!.toISOString(), sourcesConsulted: sources, ...(areaId ? { areaId: Number(areaId) } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      await qc.invalidateQueries({ queryKey: ["/api/pov/baseline"] });
      toast({ title: "Medição registrada", description: `Duração: ${fmt(stoppedMs!)}` });
      setStartedAt(null); setStoppedMs(null); setSources([]); setNote("");
    } catch (e) { toast({ title: "Não foi possível registrar", description: (e as Error).message, variant: "destructive" }); }
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold font-display flex items-center gap-2"><Timer className="w-7 h-7 text-primary" aria-hidden />Linha de base: análise sem a plataforma</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Para medir se a ARTEMIS AI reduz o tempo de análise, cronometre a <strong>mesma tarefa feita do jeito habitual</strong>, sem usar a plataforma:
          verificar focos próximos, condições do tempo e histórico de uma área e concluir o nível de risco. Depois, faça a análise na plataforma — o tempo dela é medido automaticamente.
        </p>
        {!canRecord ? <p className="mt-6 text-sm">Somente analistas, gestores ou proprietários da organização registram medições.</p> : (
          <section className="mt-6 rounded-2xl border bg-card p-5 space-y-4" aria-label="Cronômetro">
            <div>
              <label htmlFor="lb-area" className="block text-sm font-medium mb-1">Área analisada (opcional)</label>
              <select id="lb-area" value={areaId} onChange={(e) => setAreaId(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
                <option value="">—</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <p className="text-4xl font-mono tabular-nums" aria-live="polite">{fmt(stoppedMs ?? elapsed)}</p>
            <div className="flex gap-2">
              {!startedAt && <Button onClick={start}>Iniciar cronômetro</Button>}
              {startedAt && stoppedMs == null && <Button onClick={stop}>Parar — terminei a análise</Button>}
              {stoppedMs != null && <Button variant="outline" onClick={start}>Recomeçar</Button>}
            </div>
            {stoppedMs != null && (
              <div className="space-y-3">
                <fieldset><legend className="text-sm font-medium mb-1">Fontes consultadas</legend>
                  {SOURCES.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sources.includes(k)} onChange={() => setSources(sources.includes(k) ? sources.filter((x) => x !== k) : [...sources, k])} />{l}</label>)}
                </fieldset>
                <label htmlFor="lb-note" className="block text-sm font-medium">Observação (opcional)</label>
                <textarea id="lb-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="w-full rounded-lg border border-input bg-background p-2 text-sm h-16" />
                <Button onClick={save} disabled={stoppedMs < 10_000}>Registrar medição</Button>
                {stoppedMs < 10_000 && <p className="text-xs text-muted-foreground">Medições abaixo de 10 s não são aceitas.</p>}
              </div>
            )}
          </section>
        )}
        <section className="mt-6" aria-labelledby="lb-hist">
          <h2 id="lb-hist" className="font-semibold">Medições da organização ({rows.length})</h2>
          <ul className="text-sm mt-2 space-y-1">{rows.slice(0, 30).map((r) => <li key={r.id}>{new Date(r.createdAt).toLocaleString("pt-BR")} — {fmt(r.durationMs)}{r.sourcesConsulted.length ? ` · ${r.sourcesConsulted.join(", ")}` : ""}</li>)}</ul>
        </section>
      </div>
    </Layout>
  );
}
