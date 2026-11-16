import { cn } from "@/lib/utils";
import type { RiskLevel } from "@shared/risk-engine";

interface RiskBadgeProps {
  level: RiskLevel;
  score?: number;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
  className?: string;
}

const CONFIG: Record<RiskLevel, {
  label: string;
  icon: string;
  bg: string;
  text: string;
  border: string;
  dot: string;
}> = {
  baixo: {
    label: "Baixo",
    icon: "✓",
    bg: "bg-green-50",
    text: "text-green-800",
    border: "border-green-200",
    dot: "bg-green-500",
  },
  moderado: {
    label: "Moderado",
    icon: "⚠",
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  alto: {
    label: "Alto",
    icon: "▲",
    bg: "bg-orange-50",
    text: "text-orange-800",
    border: "border-orange-200",
    dot: "bg-orange-500",
  },
  crítico: {
    label: "Crítico",
    icon: "●",
    bg: "bg-red-50",
    text: "text-red-800",
    border: "border-red-200",
    dot: "bg-red-500",
  },
};

const SIZE_CLASSES = {
  sm: "text-xs px-2 py-0.5 gap-1",
  md: "text-sm px-2.5 py-1 gap-1.5",
  lg: "text-base px-3 py-1.5 gap-2",
};

const DOT_SIZES = {
  sm: "w-1.5 h-1.5",
  md: "w-2 h-2",
  lg: "w-2.5 h-2.5",
};

/** Componente reutilizável para exibir o nível de risco com acessibilidade */
export function RiskBadge({ level, score, size = "md", showIcon = false, className }: RiskBadgeProps) {
  const cfg = CONFIG[level];
  if (!cfg) return null;

  return (
    <span
      role="status"
      aria-label={`Risco ${cfg.label}${score !== undefined ? ` — pontuação ${score}` : ""}`}
      className={cn(
        "inline-flex items-center font-semibold rounded-full border",
        cfg.bg, cfg.text, cfg.border,
        SIZE_CLASSES[size],
        className,
      )}
    >
      <span className={cn("rounded-full flex-shrink-0", cfg.dot, DOT_SIZES[size])} aria-hidden />
      {showIcon && <span aria-hidden>{cfg.icon}</span>}
      <span>{cfg.label}</span>
      {score !== undefined && (
        <span className="opacity-70 font-normal ml-0.5">({score})</span>
      )}
    </span>
  );
}

/** Retorna a cor hex principal para o nível de risco (uso em mapas/charts) */
export function riskLevelColor(level: RiskLevel): string {
  return {
    baixo:    "#16a34a",
    moderado: "#d97706",
    alto:     "#ea580c",
    crítico:  "#dc2626",
  }[level] ?? "#6b7280";
}

/** Retorna label em pt-BR */
export function riskLevelLabel(level: RiskLevel): string {
  return CONFIG[level]?.label ?? level;
}

/** Retorna ícone emoji */
export function riskLevelIcon(level: RiskLevel): string {
  return CONFIG[level]?.icon ?? "?";
}

/** Retorna descrição acessível */
export function riskLevelDescription(level: RiskLevel): string {
  return {
    baixo:    "Condições favoráveis — risco controlado com monitoramento periódico.",
    moderado: "Atenção recomendada — condições podem evoluir.",
    alto:     "Risco significativo — ação preventiva urgente necessária.",
    crítico:  "Condições críticas — revisar imediatamente os protocolos preventivos e de resposta da organização.",
  }[level] ?? "";
}
