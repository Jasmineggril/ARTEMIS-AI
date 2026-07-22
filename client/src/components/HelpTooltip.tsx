import { useState, useRef } from "react";
import { HelpCircle } from "lucide-react";

interface HelpTooltipProps {
  text: string;
  className?: string;
}

export function HelpTooltip({ text, className = "" }: HelpTooltipProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      className={`relative inline-flex items-center ${className}`}
      ref={ref}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <button
        type="button"
        aria-label={`Ajuda: ${text}`}
        className="text-muted-foreground hover:text-primary focus:text-primary transition-colors outline-none"
        tabIndex={0}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {visible && (
        <div
          role="tooltip"
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-xl border border-border/60 bg-card shadow-lg px-3 py-2.5 text-xs text-foreground leading-relaxed pointer-events-none"
        >
          {text}
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border/60" />
          <div className="absolute top-full left-1/2 -translate-x-1/2 translate-y-[-1px] border-4 border-transparent border-t-card" />
        </div>
      )}
    </div>
  );
}
