import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { X, ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { PRODUCT_NAME, SUBMISSION_MODE } from "@shared/identity";
import {
  getOnboardingStatus,
  setOnboardingStatus,
  shouldShowWelcome,
} from "@/hooks/use-onboarding";
import { WelcomeModal } from "@/components/WelcomeModal";
import { useAuthStatus } from "@/hooks/use-auth";

// ─── Tour step definitions ────────────────────────────────────────────────────

const STEPS = [
  {
    target: "main-navigation",
    title: "Menu de navegação",
    text: "Utilize este menu para acessar a visão geral, áreas monitoradas, análise de risco, mapa, alertas, fontes de dados e relatórios.",
    route: null,
  },
  {
    target: "dashboard-summary",
    title: "Visão geral da operação",
    text: "Aqui você acompanha áreas monitoradas, índice médio de risco, alertas ativos, áreas prioritárias e a atualização mais recente dos dados.",
    route: "/dashboard",
  },
  {
    target: "monitored-areas",
    title: "Cadastre e acompanhe áreas",
    text: "Nesta seção, você pode registrar uma área produtiva, informar sua localização e acompanhar o histórico de análises e alertas.",
    route: null,
  },
  {
    target: "risk-analysis",
    title: "Realize uma análise de risco",
    text: "Informe os dados ambientais da área ou utilize um cenário demonstrativo para calcular o índice de risco de incêndio.",
    route: null,
  },
  {
    target: "risk-form",
    title: "Preencha os fatores ambientais",
    text: "A classificação considera fatores como temperatura, umidade, vento, precipitação, condição da vegetação, histórico de ocorrências e proximidade de focos.",
    route: "/simulacao",
  },
  {
    target: "risk-result",
    title: "Interprete o resultado",
    text: "O sistema apresenta uma pontuação de 0 a 100 e classifica o risco como baixo, moderado, alto ou crítico.",
    route: "/simulacao",
  },
  {
    target: "risk-factors",
    title: "Entenda o que influenciou o risco",
    text: "Esta seção explica quais fatores aumentaram ou reduziram a pontuação, tornando o resultado mais transparente.",
    route: "/simulacao",
  },
  {
    target: "risk-map",
    title: "Visualize áreas prioritárias",
    text: "O mapa mostra áreas monitoradas, níveis de risco, alertas e detalhes georreferenciados para apoiar a priorização das ações.",
    route: null,
  },
  {
    target: "alerts",
    title: "Acompanhe alertas preventivos",
    text: "Os alertas mostram o nível de risco, os fatores críticos, a recomendação preventiva e o status do acompanhamento.",
    route: null,
  },
  {
    target: "reports",
    title: "Registre e compartilhe evidências",
    text: "Em Relatórios, você pode consultar análises, indicadores, recomendações e evidências utilizadas na validação da solução.",
    route: null,
  },
];

const TOTAL = STEPS.length;

// ─── Spotlight rect helper ────────────────────────────────────────────────────

interface Rect { top: number; left: number; width: number; height: number }

function findElement(target: string): HTMLElement | null {
  return document.querySelector(`[data-tour="${target}"]`) as HTMLElement | null;
}

function getRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

// ─── Tooltip positioning ──────────────────────────────────────────────────────

function computeTooltipStyle(rect: Rect | null): React.CSSProperties {
  if (!rect) {
    return { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
  }
  const PAD = 16;
  const TH = 280; // approx tooltip height
  const TW = 320;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const centerX = rect.left + rect.width / 2;
  const spaceBelow = vh - (rect.top + rect.height);
  const spaceAbove = rect.top;

  let top: number, left: number;

  if (spaceBelow >= TH + PAD) {
    top = rect.top + rect.height + PAD;
  } else if (spaceAbove >= TH + PAD) {
    top = rect.top - TH - PAD;
  } else {
    top = Math.max(PAD, Math.min(vh - TH - PAD, rect.top));
  }

  left = Math.max(PAD, Math.min(vw - TW - PAD, centerX - TW / 2));

  return { position: "fixed", top, left, width: TW };
}

// ─── Main component ───────────────────────────────────────────────────────────

const PUBLIC_ROUTES = ["/", "/login", "/signup", "/reset-password", "/privacidade", "/simulacao", "/florestai"];

export function OnboardingTour() {
  const [location, setLocation] = useLocation();
  const { data: user } = useAuthStatus();
  const [showWelcome, setShowWelcome] = useState(false);
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // ── Initial check ──────────────────────────────────────────────────────────
  // Only for authenticated users inside the app — never over public or auth pages.
  useEffect(() => {
    if (!user || PUBLIC_ROUTES.includes(location)) return;
    const status = getOnboardingStatus();
    if (shouldShowWelcome() && !status.neverShow) {
      setShowWelcome(true);
      setOnboardingStatus({ started: true });
    }
  }, [user, location]);

  // ── Resolve element rect each step ────────────────────────────────────────
  const resolveStep = useCallback((stepIdx: number) => {
    const s = STEPS[stepIdx];
    // Navigate if step requires a different route
    if (s.route) {
      setLocation(s.route);
    }
    // Wait for navigation + paint
    setTimeout(() => {
      const el = findElement(s.target);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(() => setRect(getRect(el)), 300);
      } else {
        setRect(null);
      }
    }, 400);
  }, [setLocation]);

  useEffect(() => {
    if (active) resolveStep(step);
  }, [active, step, resolveStep]);

  // Re-compute rect on resize
  useEffect(() => {
    if (!active) return;
    const handler = () => {
      const el = findElement(STEPS[step].target);
      if (el) setRect(getRect(el));
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [active, step]);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active && !showComplete) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleSkip();
      if (e.key === "ArrowRight" && active) handleNext();
      if (e.key === "ArrowLeft" && active && step > 0) handlePrev();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  // ── Actions ────────────────────────────────────────────────────────────────
  function startTour() {
    setShowWelcome(false);
    setStep(0);
    setActive(true);
  }

  function handleSkip() {
    setActive(false);
    setShowComplete(false);
    setRect(null);
    setOnboardingStatus({ skipped: true });
  }

  function handleNext() {
    if (step < TOTAL - 1) {
      setStep(s => s + 1);
      setRect(null);
    } else {
      setActive(false);
      setRect(null);
      setShowComplete(true);
      setOnboardingStatus({ completed: true, currentStep: TOTAL });
    }
  }

  function handlePrev() {
    if (step > 0) { setStep(s => s - 1); setRect(null); }
  }

  // Focus trap on card
  useEffect(() => {
    if (active) cardRef.current?.focus();
  }, [active, step]);

  // ─────────────────────────────────────────────────────────────────────────
  const current = STEPS[step];
  const tooltipStyle = computeTooltipStyle(rect);
  const PADDING = 8;

  return (
    <>
      {/* Welcome modal */}
      {showWelcome && (
        <WelcomeModal
          onStart={startTour}
          onSkip={() => { setShowWelcome(false); setOnboardingStatus({ skipped: true }); }}
          onNeverShow={() => { setShowWelcome(false); setOnboardingStatus({ neverShow: true }); }}
        />
      )}

      {/* Active tour overlay */}
      {active && (
        <div aria-modal="true" role="dialog" aria-label={`Tutorial — Etapa ${step + 1} de ${TOTAL}`}>
          {/* Dark overlay */}
          <div
            ref={overlayRef}
            className="fixed inset-0 z-[9990] pointer-events-none"
            style={{ background: "rgba(0,0,0,0.55)" }}
            aria-hidden="true"
          />

          {/* Spotlight cutout — rendered as a transparent box on top of the overlay */}
          {rect && (
            <div
              className="fixed z-[9991] rounded-xl pointer-events-none"
              style={{
                top: rect.top - PADDING,
                left: rect.left - PADDING,
                width: rect.width + PADDING * 2,
                height: rect.height + PADDING * 2,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                border: "2px solid rgba(15,81,50,0.8)",
              }}
              aria-hidden="true"
            />
          )}

          {/* Clickthrough blocker (lets user see but not click outside card) */}
          <div
            className="fixed inset-0 z-[9992]"
            onClick={handleSkip}
            aria-hidden="true"
          />

          {/* Tooltip card */}
          <div
            ref={cardRef}
            tabIndex={-1}
            className="z-[9999] bg-card border border-border/60 rounded-2xl shadow-2xl p-5 outline-none"
            style={tooltipStyle}
            onClick={e => e.stopPropagation()}
          >
            {/* Progress bar */}
            <div className="flex items-center gap-1.5 mb-4">
              {Array.from({ length: TOTAL }).map((_, i) => (
                <div
                  key={i}
                  className="h-1 flex-1 rounded-full transition-colors"
                  style={{ background: i <= step ? "#0F5132" : "#e5e7eb" }}
                />
              ))}
            </div>

            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "#0F5132" }}>
                  {step + 1}
                </div>
                <span className="text-xs text-muted-foreground font-medium">Etapa {step + 1} de {TOTAL}</span>
              </div>
              <button
                onClick={handleSkip}
                className="p-1 rounded-lg text-muted-foreground hover:bg-secondary/60 transition-colors"
                aria-label="Pular tutorial"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <h3 className="font-semibold text-foreground text-sm mb-2">{current.title}</h3>
            <p className="text-muted-foreground text-xs leading-relaxed mb-5">{current.text}</p>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <button
                onClick={handleSkip}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Pular tutorial
              </button>
              <div className="flex gap-2">
                {step > 0 && (
                  <button
                    onClick={handlePrev}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border/60 text-xs font-medium hover:bg-secondary/50 transition-colors"
                  >
                    <ChevronLeft className="w-3 h-3" /> Anterior
                  </button>
                )}
                <button
                  onClick={handleNext}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90"
                  style={{ background: "#0F5132" }}
                >
                  {step === TOTAL - 1 ? "Concluir" : "Próximo"} <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Completion modal */}
      {showComplete && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowComplete(false)} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-sm rounded-3xl bg-card border border-border/50 shadow-2xl p-8 text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ background: "#0F5132" }}>
              <Flame className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-xl font-bold font-display text-foreground mb-3">Tutorial concluído</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-8">
              Agora você já conhece o fluxo principal da plataforma. Comece cadastrando uma área ou executando uma análise demonstrativa.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setShowComplete(false); setLocation("/simulacao"); }}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm hover:opacity-90 transition-all"
                style={{ background: "#0F5132" }}
              >
                Executar análise demonstrativa
              </button>
              <button
                onClick={() => { setShowComplete(false); setLocation("/dashboard"); }}
                className="w-full py-3 rounded-xl font-semibold text-foreground text-sm border border-border/60 hover:bg-secondary/50 transition-colors"
              >
                Ir para Visão Geral
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Export trigger for external use (e.g. Settings restart button) ──────────
export function triggerTour() {
  // Reset and reload — the useEffect in App will pick it up
  const status = getOnboardingStatus();
  setOnboardingStatus({ ...status, started: false, completed: false, skipped: false, neverShow: false, currentStep: 0 });
  window.location.reload();
}
