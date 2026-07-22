import { useState } from "react";
import { X, ChevronRight } from "lucide-react";

const STEPS = [
  "Identifique a área e selecione o tipo de operação.",
  "Informe a localização (município, estado, coordenadas).",
  "Preencha os dados ambientais: temperatura, umidade, vento e precipitação.",
  "Selecione a condição atual da vegetação.",
  "Informe se há foco de calor próximo e a distância estimada.",
  'Clique em "Calcular risco".',
  "Consulte a classificação (0–100) e o nível de risco.",
  "Analise os fatores críticos que influenciaram o resultado.",
  "Leia as recomendações preventivas.",
  "Salve, gere um alerta ou emita um relatório.",
];

interface AnalysisTutorialProps {
  onClose: () => void;
}

export function AnalysisTutorial({ onClose }: AnalysisTutorialProps) {
  const [step, setStep] = useState(0);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Tutorial de análise"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-sm rounded-3xl bg-card border border-border/50 shadow-2xl p-7">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:bg-secondary/60 transition-colors"
          aria-label="Fechar tutorial"
        >
          <X className="w-4 h-4" />
        </button>

        <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">Como realizar uma análise</p>
        <h2 className="text-xl font-bold font-display text-foreground mb-6">
          Passo {step + 1} de {STEPS.length}
        </h2>

        {/* Progress */}
        <div className="flex gap-1 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{ background: i <= step ? "#0F5132" : "#e5e7eb" }}
            />
          ))}
        </div>

        <p className="text-muted-foreground text-sm leading-relaxed mb-8 min-h-[3rem]">
          {STEPS[step]}
        </p>

        <div className="flex justify-between items-center">
          <button
            onClick={() => { if (step > 0) setStep(s => s - 1); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            disabled={step === 0}
          >
            Anterior
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1 px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-all"
              style={{ background: "#0F5132" }}
            >
              Próximo <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-all"
              style={{ background: "#0F5132" }}
            >
              Entendido
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
