import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

const LABEL: Record<string, string> = { pertinente: "Pertinentes", parcialmente_pertinente: "Parcialmente pertinentes", nao_pertinente: "Não pertinentes" };

/** Invited evaluator's verdict on an analysis' recommendations (Proof of Value indicator I2). */
export function RecommendationEvaluation({ analysisId, current }: { analysisId: number; current?: string | null }) {
  const { toast } = useToast();
  const [v, setV] = useState(current ?? "");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<string | null>(current ?? null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api("POST", `/api/analyses/${analysisId}/recommendation-evaluation`, { evaluation: v, ...(note.trim() ? { note: note.trim() } : {}) });
      setSaved(v);
      toast({ title: "Avaliação das recomendações registrada" });
    } catch (e) {
      toast({ title: "Não foi possível registrar", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-4 border-t pt-3" data-testid="recommendation-evaluation">
      <p className="text-sm font-medium">Estas recomendações são adequadas para a situação da área?</p>
      <p className="text-xs text-muted-foreground mb-2">Avaliação de especialista — usada para medir a utilidade real das recomendações.{saved ? ` Registrado: ${LABEL[saved]}.` : ""}</p>
      <div role="radiogroup" aria-label="Avaliação das recomendações" className="flex flex-wrap gap-2">
        {Object.entries(LABEL).map(([k, l]) => (
          <label key={k} className={`text-sm rounded-full border px-3 py-1 cursor-pointer ${v === k ? "bg-primary text-primary-foreground border-primary" : ""}`}>
            <input type="radio" name={`rec-${analysisId}`} value={k} checked={v === k} onChange={() => setV(k)} className="sr-only" />{l}
          </label>))}
      </div>
      <label htmlFor={`rec-note-${analysisId}`} className="sr-only">Justificativa</label>
      <textarea id={`rec-note-${analysisId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
        placeholder={v && v !== "pertinente" ? "Justificativa (obrigatória)" : "Observação (opcional)"} className="w-full mt-2 rounded-lg border border-input bg-background p-2 text-sm h-14" />
      <Button size="sm" variant="outline" className="mt-2" onClick={save} disabled={!v || busy || (v !== "pertinente" && note.trim().length < 5)}>Registrar avaliação</Button>
    </div>
  );
}
