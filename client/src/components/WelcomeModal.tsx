import { useEffect, useRef } from "react";
import { Leaf, X } from "lucide-react";
import { PRODUCT_NAME, SUBMISSION_MODE } from "@shared/identity";
import { setOnboardingStatus } from "@/hooks/use-onboarding";

interface WelcomeModalProps {
  onStart: () => void;
  onSkip: () => void;
  onNeverShow: () => void;
}

export function WelcomeModal({ onStart, onSkip, onNeverShow }: WelcomeModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Trap focus inside modal
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onSkip(); return; }
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onSkip]);

  const title = SUBMISSION_MODE
    ? "Bem-vindo à Plataforma Preditiva de Inteligência Ambiental"
    : `Bem-vindo ao ${PRODUCT_NAME}`;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onSkip}
        aria-hidden="true"
      />

      {/* Card */}
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-3xl bg-card border border-border/50 shadow-2xl p-8"
      >
        <button
          onClick={onSkip}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:bg-secondary/60 transition-colors"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Icon */}
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
          style={{ background: "#0F5132" }}
        >
          <Leaf className="w-7 h-7 text-white" />
        </div>

        <h2 id="welcome-title" className="text-2xl font-bold font-display text-foreground mb-3">
          {title}
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          Este tutorial apresenta as principais funcionalidades da plataforma e mostra como realizar
          uma análise de risco de incêndio, interpretar resultados e acompanhar áreas monitoradas.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={onStart}
            className="w-full py-3 rounded-xl font-semibold text-white text-sm transition-all hover:opacity-90"
            style={{ background: "#0F5132" }}
          >
            Iniciar tutorial
          </button>
          <button
            onClick={onSkip}
            className="w-full py-3 rounded-xl font-semibold text-foreground text-sm border border-border/60 hover:bg-secondary/50 transition-colors"
          >
            Explorar sozinho
          </button>
          <button
            onClick={onNeverShow}
            className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Não mostrar novamente
          </button>
        </div>
      </div>
    </div>
  );
}
