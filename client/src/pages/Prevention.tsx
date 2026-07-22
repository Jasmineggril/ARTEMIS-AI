import { useState } from "react";
import { Layout } from "@/components/Layout";
import { RiskBadge, riskLevelColor } from "@/components/RiskBadge";
import { DECISION_SUPPORT_DISCLAIMER } from "@shared/identity";
import { ShieldCheck, AlertTriangle, Info, ChevronDown, ChevronUp, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@shared/risk-engine";

const PROTOCOLS: Record<RiskLevel, { actions: string[]; checklist: string[] }> = {
  baixo: {
    actions: [
      "Manter monitoramento periódico das condições ambientais (temperatura, umidade, vento).",
      "Verificar estado dos aceiros e equipamentos de combate a incêndio.",
      "Garantir que equipes conheçam os protocolos de emergência.",
      "Registrar condições observadas em campo para histórico.",
      "Realizar inspeção visual das áreas de maior risco histórico.",
    ],
    checklist: [
      "Aceiros inspecionados e limpos",
      "Equipamentos de combate revisados",
      "Equipes cientes dos protocolos",
      "Comunicação com autoridades em dia",
      "Registros de monitoramento atualizados",
    ],
  },
  moderado: {
    actions: [
      "Intensificar frequência de monitoramento e inspeção de campo.",
      "Reforçar aceiros existentes e criar novos ao redor das áreas críticas.",
      "Alertar equipes locais sobre condições de risco moderado.",
      "Verificar disponibilidade e funcionalidade de equipamentos de combate.",
      "Reduzir ou suspender atividades geradoras de faíscas nos horários mais quentes.",
      "Comunicar situação às equipes de gestão e segurança.",
    ],
    checklist: [
      "Aceiros reforçados nas zonas críticas",
      "Equipes em estado de prontidão",
      "Atividades de risco suspensas nos horários de pico",
      "Comunicação interna realizada",
      "Rotas de evacuação verificadas",
      "Bombeiros e órgãos competentes informados preventivamente",
    ],
  },
  alto: {
    actions: [
      "Acionar protocolo de prontidão — equipes em estado de alerta imediato.",
      "Restringir todas as atividades geradoras de faíscas, fogo ou calor intenso.",
      "Verificar disponibilidade de equipamentos e rotas de acesso às áreas de risco.",
      "Estabelecer comunicação direta com Bombeiros, IBAMA e Defesa Civil.",
      "Realocar pessoas e equipamentos críticos para fora das zonas de risco.",
      "Ativar sistema de monitoramento contínuo (câmeras, rondas, sensores).",
      "Registrar todas as ações tomadas para fins de auditoria e seguro.",
    ],
    checklist: [
      "Protocolo de prontidão ativado",
      "Atividades de risco suspensas",
      "Bombeiros e Defesa Civil comunicados",
      "Sistema de monitoramento contínuo ativo",
      "Pessoal em áreas de risco realocado",
      "Canal de comunicação de emergência estabelecido",
      "Registro de ações iniciado",
    ],
  },
  crítico: {
    actions: [
      "ACIONAR IMEDIATAMENTE brigada de incêndio e protocolo de emergência.",
      "Comunicar Bombeiros (193), IBAMA e Defesa Civil sobre condição crítica.",
      "Suspender todas as atividades produtivas nas áreas de risco.",
      "Evacuar áreas vulneráveis e isolar perímetro de risco.",
      "Solicitar apoio aéreo se disponível (helicópteros, aviões-tanque).",
      "Estabelecer posto de comando para coordenação das ações.",
      "Documentar todas as ações, horários e decisões para auditoria.",
      "Notificar seguradoras e acionistas sobre situação de risco crítico.",
    ],
    checklist: [
      "Bombeiros (193) acionados",
      "IBAMA e Defesa Civil comunicados",
      "Evacuação de pessoal concluída",
      "Perímetro de isolamento estabelecido",
      "Posto de comando ativado",
      "Apoio aéreo solicitado (se aplicável)",
      "Documentação de emergência iniciada",
      "Seguradoras notificadas",
    ],
  },
};

const BEST_PRACTICES = [
  { title: "Monitoramento contínuo", desc: "Implante sensores de temperatura, umidade e vento nas áreas de maior risco. Dados em tempo real permitem reação mais rápida." },
  { title: "Treinamento periódico", desc: "Equipes devem ser treinadas regularmente em combate a incêndio, uso de equipamentos e protocolos de evacuação." },
  { title: "Manutenção de aceiros", desc: "Aceiros devem ser limpos e inspecionados antes e durante o período de seca. A largura mínima varia por bioma e regulamentação local." },
  { title: "Plano de contingência documentado", desc: "O plano deve estar disponível a todos, incluir rotas de evacuação, contatos de emergência e cadeia de responsabilidade." },
  { title: "Integração com órgãos públicos", desc: "Mantenha canais de comunicação atualizados com Bombeiros, IBAMA, Defesa Civil e secretarias estaduais de meio ambiente." },
  { title: "Adaptação aos protocolos internos", desc: "Estes protocolos são referenciais. Cada operação deve adaptá-los às suas normas internas, regulatórias e de seguro." },
];

function ProtocolSection({ level }: { level: RiskLevel }) {
  const [open, setOpen] = useState(level === "crítico");
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const p = PROTOCOLS[level];

  const toggleCheck = (i: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden shadow-sm">
      <button
        className="w-full flex items-center justify-between p-5 hover:bg-muted/20 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <RiskBadge level={level} size="md" />
          <span className="font-semibold text-foreground">Protocolo de {level.charAt(0).toUpperCase() + level.slice(1)} Risco</span>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border/30 p-5 grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" style={{ color: riskLevelColor(level) }} />
              Ações recomendadas
            </h3>
            <ol className="space-y-2">
              {p.actions.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="font-bold shrink-0 mt-0.5" style={{ color: riskLevelColor(level) }}>{i + 1}.</span>
                  {a}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-primary" />
              Checklist de acompanhamento
            </h3>
            <div className="space-y-2">
              {p.checklist.map((item, i) => (
                <label key={i} className="flex items-center gap-2 text-sm cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={checked.has(i)}
                    onChange={() => toggleCheck(i)}
                    className="rounded text-primary"
                  />
                  <span className={cn("transition-colors", checked.has(i) ? "line-through text-muted-foreground/50" : "text-foreground")}>
                    {item}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {checked.size}/{p.checklist.length} itens concluídos
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Prevention() {
  return (
    <Layout>
      <header className="mb-8">
        <h1 className="text-3xl font-bold font-display text-foreground flex items-center gap-2">
          <ShieldCheck className="w-8 h-8 text-primary" />
          Protocolos de Prevenção
        </h1>
        <p className="text-muted-foreground mt-2">
          Ações e checklists por nível de risco para equipes operacionais.
        </p>
      </header>

      {/* Aviso */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 mb-8">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          <strong>Estes protocolos são referenciais e demonstrativos.</strong> {DECISION_SUPPORT_DISCLAIMER}{" "}
          Cada operação deve adaptá-los às suas normas internas, requisitos regulatórios e exigências de seguro.
        </p>
      </div>

      {/* Protocolos por nível */}
      <div className="space-y-4 mb-10">
        {(["crítico", "alto", "moderado", "baixo"] as RiskLevel[]).map(level => (
          <ProtocolSection key={level} level={level} />
        ))}
      </div>

      {/* Boas práticas */}
      <section>
        <h2 className="text-xl font-bold font-display text-foreground mb-5 flex items-center gap-2">
          <Info className="w-5 h-5 text-primary" />
          Boas práticas gerais
        </h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          {BEST_PRACTICES.map(p => (
            <div key={p.title} className="bg-card border border-border/50 rounded-2xl p-5 shadow-sm">
              <h3 className="font-semibold text-foreground mb-2 text-sm">{p.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </Layout>
  );
}
