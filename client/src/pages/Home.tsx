import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/RiskBadge";
import { ArtemisMark } from "@/components/ArtemisMark";
import {
  Flame, Map, Bell, BarChart3, FileText, Database,
  ShieldCheck, CheckCircle2, AlertTriangle, ChevronRight,
  Thermometer, Wind, Droplets, Target, Info,
  Wifi, Bot, MapPin, Clock, Smartphone, Users, Leaf
} from "lucide-react";
import {
  PRODUCT_NAME, PRODUCT_TAGLINE, PRODUCT_DESCRIPTION,
  SIMULATED_DATA_LABEL, TRL_LABEL, SUBMISSION_MODE
} from "@shared/identity";
import { useAuthStatus } from "@/hooks/use-auth";
import { useLogout } from "@/hooks/use-auth";
import { useState } from "react";
import { User, LogOut } from "lucide-react";

function PublicHeader() {
  const { data: user } = useAuthStatus();
  const logout = useLogout();
  const [, setLocation] = useLocation();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <header className="sticky top-0 z-40 backdrop-blur-sm border-b border-border/40 bg-card/95">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ArtemisMark className="w-9 h-9 shrink-0" />
          {!SUBMISSION_MODE && (
            <span className="font-bold text-base text-foreground hidden sm:block">{PRODUCT_NAME}</span>
          )}
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <a href="/florestai" className="hover:text-foreground transition-colors font-semibold">Consulta pública</a>
          <a href="#solucao" className="hover:text-foreground transition-colors">Solução</a>
          <a href="#como-funciona" className="hover:text-foreground transition-colors">Como funciona</a>
          <a href="#setores" className="hover:text-foreground transition-colors">Setores</a>
          <a href="#trl" className="hover:text-foreground transition-colors">TRL 4</a>
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-secondary/50 transition-colors text-sm"
              >
                <User className="w-4 h-4" />
                <span className="hidden sm:block font-medium">{user.name}</span>
              </button>
              {showMenu && (
                <div className="absolute right-0 mt-2 w-44 bg-card border border-border/50 rounded-lg shadow-lg overflow-hidden z-50">
                  <button onClick={() => { setLocation("/dashboard"); setShowMenu(false); }}
                    className="w-full text-left px-4 py-2 hover:bg-secondary/50 text-sm">
                    Painel
                  </button>
                  <button onClick={() => { logout.mutate(); setShowMenu(false); }}
                    className="w-full text-left px-4 py-2 hover:bg-destructive/10 text-sm text-destructive flex items-center gap-2">
                    <LogOut className="w-4 h-4" /> Sair
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setLocation("/login")}>Entrar</Button>
              <Button size="sm" onClick={() => setLocation("/signup")}>Criar conta</Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();

  const features = [
    { icon: Flame,      title: "Análise Preditiva",      desc: "Motor de classificação de risco baseado em regras documentadas e fatores ambientais." },
    { icon: Map,        title: "Mapa de Risco",           desc: "Visualização georreferenciada de áreas monitoradas e focos de incêndio." },
    { icon: Bell,       title: "Alertas Preventivos",     desc: "Geração automática de alertas por nível de risco com recomendações." },
    { icon: Database,   title: "Fontes de Dados",         desc: "Integração com dados climáticos reais (Open-Meteo) e bases simuladas identificadas." },
    { icon: BarChart3,  title: "Inteligência Operacional",desc: "Gráficos de evolução do risco, distribuição por nível e fatores críticos." },
    { icon: FileText,   title: "Relatórios e Evidências", desc: "Geração de relatórios de análise com identificação de dados simulados e versão do motor." },
    { icon: ShieldCheck,title: "Protocolos de Prevenção", desc: "Ações recomendadas por nível de risco para equipes operacionais." },
    { icon: Target,     title: "Histórico de Análises",   desc: "Registro das análises realizadas para auditoria e acompanhamento." },
  ];

  const steps = [
    { n: "1", title: "Integra dados",          desc: "Dados climáticos, ambientais e operacionais da área monitorada." },
    { n: "2", title: "Calcula o risco",         desc: "Motor baseado em regras documentadas gera um índice de 0 a 100." },
    { n: "3", title: "Identifica fatores",      desc: "Cada fator (temperatura, umidade, vento, vegetação…) tem sua contribuição explicada." },
    { n: "4", title: "Exibe áreas prioritárias",desc: "Visualização no mapa e no painel das áreas em maior risco." },
    { n: "5", title: "Emite alertas",           desc: "Alertas por nível gerados e registrados automaticamente." },
    { n: "6", title: "Recomenda ações",         desc: "Recomendações preventivas adaptadas ao nível de risco detectado." },
    { n: "7", title: "Registra evidências",     desc: "Análise salva com dados, fatores, versão do motor e horário para auditoria." },
  ];

  const sectors = [
    { icon: "🌾", name: "Agroindústria",              desc: "Proteção de áreas agrícolas e processamento." },
    { icon: "🌲", name: "Empresas florestais",         desc: "Plantios, reservas e ativos florestais." },
    { icon: "⚡", name: "Energia",                     desc: "Usinas, linhas de transmissão e parques eólicos/solares." },
    { icon: "⛏️", name: "Mineração",                  desc: "Áreas de lavra, beneficiamento e estruturas." },
    { icon: "🚛", name: "Logística e ativos",          desc: "Operações com ativos territoriais expostos a risco." },
    { icon: "🏭", name: "Outras unidades produtivas",  desc: "Qualquer operação industrial com exposição a incêndios." },
  ];

  const povGoals = [
    { label: "Meta prevista", value: "≥ 30%", desc: "redução no tempo de análise de risco vs. processo manual" },
    { label: "Resultado esperado", value: "100%", desc: "da área piloto processada e com análise registrada" },
    { label: "A ser validado na PoV", value: "≥ 80%", desc: "de validação dos alertas e recomendações por especialistas" },
  ];

  return (
    <div className="min-h-screen bg-background font-sans">
      <PublicHeader />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0F5132] via-[#1a6b42] to-[#0d4028] text-white">
        <div className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle at 70% 50%, #C9A227 0%, transparent 60%)" }} />
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28 relative">
          {/* Badges */}
          <div className="flex flex-wrap gap-2 mb-6">
            <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 text-white text-xs font-medium px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
              {TRL_LABEL}
            </span>
            <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 text-white/80 text-xs px-3 py-1 rounded-full">
              <Info className="w-3 h-3" />
              {SIMULATED_DATA_LABEL}
            </span>
          </div>

          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold font-display leading-tight mb-6">
              {PRODUCT_TAGLINE}
            </h1>
            <p className="text-lg md:text-xl text-white/80 leading-relaxed mb-10 max-w-2xl">
              {PRODUCT_DESCRIPTION}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={() => setLocation("/simulacao")}
                size="lg"
                className="bg-white text-[#0F5132] hover:bg-white/90 font-bold text-base px-8 shadow-xl"
                data-testid="button-hero-primary"
              >
                <Flame className="w-5 h-5 mr-2" />
                Simular análise de risco
              </Button>
              <Button
                onClick={() => setLocation("/dashboard")}
                variant="outline"
                size="lg"
                className="border-white/40 text-white hover:bg-white/10 font-semibold text-base px-8"
                data-testid="button-hero-secondary"
              >
                Conhecer a plataforma
                <ChevronRight className="w-5 h-5 ml-1" />
              </Button>
            </div>
          </div>

          {/* Demo risk preview */}
          <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl">
            {(["baixo", "moderado", "alto", "crítico"] as const).map(level => (
              <div key={level} className="bg-white/10 border border-white/20 rounded-xl p-3 text-center">
                <RiskBadge level={level} size="sm" />
                <p className="text-xs text-white/60 mt-1.5">Classificação</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Aviso ────────────────────────────────────────────────────────── */}
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-start gap-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          <span>
            Os resultados apresentados neste protótipo utilizam dados públicos, históricos ou simulados e
            <strong> não substituem avaliação técnica oficial</strong>.
          </span>
        </div>
      </div>

      {/* ── Problema ─────────────────────────────────────────────────────── */}
      <section id="solucao" className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="text-xs font-semibold uppercase tracking-widest text-primary mb-3 block">O Problema</span>
            <h2 className="text-3xl md:text-4xl font-bold font-display text-foreground mb-6 leading-tight">
              Análise manual de risco é lenta e fragmentada
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed mb-6">
              Bases ambientais e geoespaciais são frequentemente consultadas separadamente, exigindo análise
              manual e dificultando a priorização rápida de áreas críticas.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              O resultado é perda de tempo, retrabalho e decisões tardias — justamente quando a velocidade de
              resposta pode fazer a diferença entre conter ou perder uma área produtiva.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: Thermometer, label: "Temperatura", color: "text-orange-600", bg: "bg-orange-50" },
              { icon: Droplets,    label: "Umidade",     color: "text-blue-600",   bg: "bg-blue-50" },
              { icon: Wind,        label: "Vento",        color: "text-slate-600",  bg: "bg-slate-50" },
              { icon: Flame,       label: "Vegetação",    color: "text-green-700",  bg: "bg-green-50" },
            ].map(f => (
              <div key={f.label} className={`${f.bg} rounded-2xl p-5 flex flex-col items-center gap-2 border border-border/30`}>
                <f.icon className={`w-8 h-8 ${f.color}`} />
                <span className="text-sm font-semibold text-foreground">{f.label}</span>
                <span className="text-xs text-muted-foreground text-center">Fator de risco</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Como funciona ─────────────────────────────────────────────────── */}
      <section id="como-funciona" className="bg-muted/30 border-y border-border/30 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <span className="text-xs font-semibold uppercase tracking-widest text-primary mb-3 block">Fluxo tecnológico</span>
            <h2 className="text-3xl md:text-4xl font-bold font-display text-foreground">Como funciona</h2>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            {steps.map((step, i) => (
              <div key={step.n} className="relative">
                <div className="bg-card rounded-2xl p-5 border border-border/50 shadow-sm h-full">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center mb-3">
                    {step.n}
                  </div>
                  <h3 className="font-semibold text-foreground mb-1 text-sm">{step.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-2 w-4 h-0.5 bg-border" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Diferencial ──────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="bg-gradient-to-r from-[#0F5132]/5 to-transparent border border-primary/20 rounded-3xl p-10">
          <div className="max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-widest text-primary mb-3 block">Diferencial</span>
            <h2 className="text-2xl md:text-3xl font-bold font-display text-foreground mb-5">
              Não apenas registra focos. Prevê riscos.
            </h2>
            <p className="text-muted-foreground leading-relaxed text-lg">
              A solução não apenas apresenta focos já registrados: <strong>calcula o risco por área produtiva</strong>,
              explica fatores críticos e recomenda ações preventivas antes da ocorrência.
            </p>
          </div>
        </div>
      </section>

      {/* ── Setores ──────────────────────────────────────────────────────── */}
      <section id="setores" className="bg-muted/20 border-y border-border/30 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <span className="text-xs font-semibold uppercase tracking-widest text-primary mb-3 block">Setores atendidos</span>
            <h2 className="text-3xl md:text-4xl font-bold font-display text-foreground">Para quem é esta plataforma</h2>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-5">
            {sectors.map(s => (
              <div key={s.name} className="bg-card rounded-2xl p-6 border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                <span className="text-3xl mb-3 block">{s.icon}</span>
                <h3 className="font-semibold text-foreground mb-1">{s.name}</h3>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Funcionalidades ──────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary mb-3 block">Funcionalidades</span>
          <h2 className="text-3xl md:text-4xl font-bold font-display text-foreground">O que a plataforma oferece</h2>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5">
          {features.map(f => (
            <div key={f.title} className="group bg-card rounded-2xl p-6 border border-border/50 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2 text-sm">{f.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Metas da PoV ─────────────────────────────────────────────────── */}
      <section className="bg-muted/30 border-y border-border/30 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <span className="text-xs font-semibold uppercase tracking-widest text-amber-600 mb-3 block">Prova de Valor · 60 dias</span>
            <h2 className="text-3xl md:text-4xl font-bold font-display text-foreground">Metas previstas — a validar</h2>
            <p className="text-muted-foreground mt-3">
              Não são resultados alcançados. São metas a serem validadas durante a Prova de Valor.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {povGoals.map(g => (
              <div key={g.value} className="bg-card rounded-2xl p-7 border border-border/50 shadow-sm text-center">
                <span className="text-xs font-semibold text-amber-600 uppercase tracking-wide block mb-2">{g.label}</span>
                <p className="text-4xl font-bold text-foreground mb-2">{g.value}</p>
                <p className="text-sm text-muted-foreground">{g.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Mobile ───────────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <span className="inline-block px-3 py-1 text-xs font-bold rounded-full mb-4 uppercase tracking-widest" style={{ background: "#e8f5e9", color: "#0F5132" }}>Em breve · Mobile</span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold font-display text-foreground mb-5">
              {PRODUCT_NAME}<br />no seu celular
            </h2>
            <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
              O roadmap inclui um aplicativo mobile para que equipes de campo possam consultar o índice de risco, receber alertas e acionar protocolos — de qualquer lugar, mesmo com conectividade limitada.
            </p>
            <div className="space-y-4 mb-8">
              {[
                { icon: <Wifi className="w-4 h-4" />,   t: "Modo offline",            d: "Acesso ao índice de risco sem conexão à internet" },
                { icon: <Bot className="w-4 h-4" />,    t: "IA por voz",              d: "Consulte o assistente sobre fatores de risco por áudio" },
                { icon: <MapPin className="w-4 h-4" />, t: "Alertas por localização", d: "Avisos sobre áreas monitoradas (previsto para a próxima fase)" },
                { icon: <Clock className="w-4 h-4" />,  t: "Protocolos rápidos",      d: "Checklists de prevenção acessíveis durante operações" },
              ].map((f, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#e8f5e9", color: "#0F5132" }}>
                    {f.icon}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground text-sm">{f.t}</p>
                    <p className="text-muted-foreground text-xs mt-0.5">{f.d}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground font-medium">
              <Smartphone className="w-4 h-4" />
              Roadmap 2027 · iOS e Android
            </div>
          </div>

          {/* Phone mockup */}
          <div className="flex justify-center lg:justify-end">
            <div className="relative">
              {/* Glow */}
              <div className="absolute inset-0 rounded-[48px] blur-2xl opacity-20" style={{ background: "#0F5132", transform: "scale(0.9) translateY(20px)" }} />
              {/* Phone frame */}
              <div className="relative w-72 rounded-[44px] overflow-hidden shadow-2xl border-8 border-gray-900" style={{ background: "#111" }}>
                {/* Notch */}
                <div className="flex justify-center pt-2 pb-1">
                  <div className="w-24 h-5 rounded-full" style={{ background: "#111" }} />
                </div>
                {/* Screen */}
                <div style={{ background: "#0F5132", minHeight: 560 }}>
                  {/* Status bar */}
                  <div className="flex justify-between items-center px-5 pt-1 pb-3 text-xs text-white/70">
                    <span>9:41</span>
                    <div className="flex gap-1.5 items-center">
                      <Wifi className="w-3 h-3" />
                      <span>●●●</span>
                    </div>
                  </div>
                  {/* App header */}
                  <div className="px-5 pb-5">
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <p className="text-green-300 text-xs">Bom dia, Operador</p>
                        <p className="text-white font-bold text-lg font-display">{PRODUCT_NAME}</p>
                      </div>
                      <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center">
                        <Leaf className="w-5 h-5 text-white" />
                      </div>
                    </div>
                    {/* Risk score card */}
                    <div className="rounded-2xl p-4 mb-4" style={{ background: "rgba(255,255,255,0.12)" }}>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-white text-xs font-semibold">Índice de Risco</p>
                        <span className="text-xs text-green-300 font-bold">Fazenda Pioneira</span>
                      </div>
                      <div className="flex items-end justify-between">
                        <span className="text-5xl font-bold text-white font-display">72</span>
                        <div className="flex flex-col items-end gap-1 mb-1">
                          <span className="text-green-300 text-xs">/100</span>
                          <span className="text-orange-400 text-xs font-bold">⚠ Alto</span>
                        </div>
                      </div>
                      <div className="mt-3 rounded-full overflow-hidden h-1.5 bg-white/20">
                        <div className="h-full rounded-full" style={{ width: "72%", background: "#f97316" }} />
                      </div>
                    </div>
                    {/* Quick action */}
                    <div className="rounded-xl p-3.5 mb-3 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.1)" }}>
                      <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-white text-xs font-semibold">Assistente IA</p>
                        <p className="text-green-300 text-xs">O que fazer com risco alto?</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-white/50" />
                    </div>
                    {/* Alert */}
                    <div className="rounded-xl p-3.5 flex items-center gap-3" style={{ background: "rgba(249,115,22,0.2)" }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(249,115,22,0.3)" }}>
                        <AlertTriangle className="w-4 h-4 text-orange-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-white text-xs font-semibold">2 alertas ativos</p>
                        <p className="text-orange-300 text-xs">Toque para ver protocolos</p>
                      </div>
                    </div>
                  </div>
                  {/* Bottom nav */}
                  <div className="flex justify-around py-4 px-3 border-t border-white/10">
                    {[
                      { icon: <BarChart3 className="w-5 h-5" />, label: "Risco" },
                      { icon: <Bot className="w-5 h-5" />, label: "IA" },
                      { icon: <Map className="w-5 h-5" />, label: "Mapa" },
                      { icon: <Users className="w-5 h-5" />, label: "Equipe" },
                    ].map((item, i) => (
                      <div key={i} className={`flex flex-col items-center gap-1 ${i === 0 ? "text-white" : "text-white/40"}`}>
                        {item.icon}
                        <span className="text-xs">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TRL 4 ────────────────────────────────────────────────────────── */}
      <section id="trl" className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="text-xs font-semibold uppercase tracking-widest text-primary mb-3 block">Estado de maturidade</span>
            <h2 className="text-3xl font-bold font-display text-foreground mb-6">TRL 4 — Protótipo funcional</h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              A solução possui arquitetura definida, protótipo funcional e componentes integrados e testados em
              ambiente controlado. A validação em ambiente produtivo relevante será realizada durante a Prova de Valor.
            </p>
            <div className="space-y-3">
              {[
                "Entrada e processamento de dados ambientais",
                "Motor de classificação de risco (baseado em regras documentadas)",
                "Visualização georreferenciada no mapa",
                "Geração de alertas e recomendações",
                "Testes automatizados do motor de risco",
                "Identificação clara de dados simulados",
              ].map(item => (
                <div key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-card border border-border/50 rounded-3xl p-8 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Target className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="font-bold text-foreground">TRL 4</p>
                <p className="text-sm text-muted-foreground">Technology Readiness Level</p>
              </div>
            </div>
            <div className="space-y-2 mb-6">
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <div key={n} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                    ${n <= 4 ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                    {n}
                  </div>
                  <div className={`flex-1 h-2 rounded-full ${n <= 4 ? "bg-primary" : "bg-muted"}`} />
                  {n === 4 && <span className="text-xs font-semibold text-primary">← Atual</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Validação em ambiente operacional real prevista para a Prova de Valor.
            </p>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-r from-[#0F5132] to-[#1a6b42] py-20">
        <div className="max-w-7xl mx-auto px-6 text-center text-white">
          <h2 className="text-3xl md:text-4xl font-bold font-display mb-4">Pronto para simular uma análise?</h2>
          <p className="text-white/80 mb-8 text-lg">Insira os dados da área e veja o índice de risco calculado em segundos.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={() => setLocation("/simulacao")}
              size="lg"
              className="bg-white text-[#0F5132] hover:bg-white/90 font-bold px-8"
            >
              <Flame className="w-5 h-5 mr-2" />
              Simular análise de risco
            </Button>
            <Button
              onClick={() => setLocation("/signup")}
              variant="outline"
              size="lg"
              className="border-white/40 text-white hover:bg-white/10 px-8"
            >
              Criar conta gratuita
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/40 py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <ArtemisMark className="w-7 h-7 shrink-0" />
            {!SUBMISSION_MODE && <span className="font-medium">{PRODUCT_NAME}</span>}
          </div>
          <p className="text-center">
            Plataforma preditiva de inteligência ambiental · {TRL_LABEL}
          </p>
          <p className="text-xs text-muted-foreground/60">
            © {new Date().getFullYear()} — Uso demonstrativo
          </p>
        </div>
      </footer>
    </div>
  );
}
