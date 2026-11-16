import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  Flame, Map, Bell, FileText, ShieldCheck, Users, Search, Building2, Tractor, GraduationCap, Landmark,
  Settings2, User, LogOut, Satellite, CloudSun, Upload, Info, Phone, ArrowRight, Database, Lock, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RiskBadge, riskLevelColor } from "@/components/RiskBadge";
import { ArtemisMark, ArtemisWordmark } from "@/components/ArtemisMark";
import { HotspotConstellation, type GridCell, type StateAgg } from "@/components/home/HotspotConstellation";
import { useAuthStatus, useLogout } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { PRODUCT_NAME, PRODUCT_TAGLINE, SUBMISSION_MODE, TRL_LABEL, EMERGENCY_NOTICE, DECISION_SUPPORT_DISCLAIMER } from "@shared/identity";
import type { RiskLevel } from "@shared/risk-engine";

interface Grid { period: { from: string; to: string }; total: number; municipalities: number; cells: GridCell[]; states: StateAgg[]; lastSyncAt: string | null }
interface Connector { key: string; name: string; status: string; note: string; lastSuccessAt?: string | null }

/** Fade-up when the block enters the viewport (disabled for reduced motion). */
function Reveal({ children, className = "", delay = 0, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "li" }) {
  const ref = useRef<any>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${seen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"} ${className}`}>
      {children}
    </Tag>
  );
}

function PublicHeader() {
  const { data: user } = useAuthStatus();
  const logout = useLogout();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#061A14]/90 backdrop-blur text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5">
          <ArtemisMark className="w-9 h-9 shrink-0" inverted />
          {!SUBMISSION_MODE && <ArtemisWordmark inverted />}
        </Link>
        <nav className="hidden lg:flex items-center gap-7 text-sm text-emerald-100/80" aria-label="Seções">
          <a href="/consulta-publica" className="hover:text-white font-semibold text-white">Consulta pública</a>
          <a href="#como-funciona" className="hover:text-white">Como funciona</a>
          <a href="#para-quem" className="hover:text-white">Para quem</a>
          <a href="#dados" className="hover:text-white">Dados e limites</a>
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <div className="relative">
              <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 text-sm">
                <User className="w-4 h-4" aria-hidden /><span className="hidden sm:block font-medium">{user.name}</span>
              </button>
              {open && (
                <div className="absolute right-0 mt-2 w-44 bg-card text-foreground border rounded-lg shadow-lg overflow-hidden z-50">
                  <button onClick={() => setLocation("/dashboard")} className="w-full text-left px-4 py-2 hover:bg-secondary/50 text-sm">Painel</button>
                  <button onClick={() => logout.mutate()} className="w-full text-left px-4 py-2 hover:bg-destructive/10 text-sm text-destructive flex items-center gap-2">
                    <LogOut className="w-4 h-4" aria-hidden /> Sair
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <button onClick={() => setLocation("/login")} className="px-3 py-2 text-sm font-medium rounded-lg hover:bg-white/10">Entrar</button>
              <button onClick={() => setLocation("/signup")} className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-400 text-[#061A14] hover:bg-emerald-300">Criar conta</button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-3xl sm:text-4xl font-bold tabular-nums text-white">{value}</p>
      <p className="text-xs sm:text-sm text-emerald-100/75 mt-1">{label}</p>
    </div>
  );
}

function Hero() {
  const [, setLocation] = useLocation();
  const { data: g, isLoading } = useQuery<Grid>({ queryKey: ["/api/public/hotspots/grid"], queryFn: () => api("GET", "/api/public/hotspots/grid") });
  const synced = !!g?.lastSyncAt;
  return (
    <section className="relative overflow-hidden bg-[#061A14] text-white">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,rgba(234,88,12,0.18),transparent_55%),radial-gradient(ellipse_at_10%_90%,rgba(16,185,129,0.18),transparent_50%)]" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-10 lg:pt-16 grid lg:grid-cols-[1fr_1.05fr] gap-10 items-center">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400" aria-hidden /> Inteligência ambiental para prevenção de incêndios
          </p>
          <h1 className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-bold font-display leading-[1.05] tracking-tight text-white">
            Inteligência para <span className="text-orange-300">antecipar riscos</span>.<br className="hidden sm:block" /> Tecnologia para <span className="text-emerald-300">proteger territórios</span>.
          </h1>
          <p className="mt-6 text-lg text-emerald-50/85 max-w-xl">
            Clima, focos de calor por satélite e históricos de ocorrências reunidos num índice de risco explicável — com a origem de cada dado sempre à vista.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <button onClick={() => setLocation("/consulta-publica")} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-400 px-6 py-3.5 font-semibold text-[#1c0a00] hover:bg-orange-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <Search className="w-5 h-5" aria-hidden /> Ver focos e ocorrências
            </button>
            <button onClick={() => setLocation("/signup")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 px-6 py-3.5 font-semibold text-white hover:bg-white/10">
              Monitorar minhas áreas <ArrowRight className="w-4 h-4" aria-hidden />
            </button>
          </div>
          <div className="mt-10 grid grid-cols-3 gap-6 max-w-lg" aria-live="polite">
            {synced ? (
              <>
                <Stat value={g!.total.toLocaleString("pt-BR")} label="detecções por satélite" />
                <Stat value={g!.municipalities.toLocaleString("pt-BR")} label="municípios com focos" />
                <Stat value={String(g!.states.length)} label="estados com focos" />
              </>
            ) : (
              <p className="col-span-3 text-sm text-emerald-100/75">{isLoading ? "Carregando dados do INPE…" : "A sincronização com o INPE ainda não foi realizada; nenhum número é exibido até lá."}</p>
            )}
          </div>
          {synced && (
            <p className="mt-3 text-xs text-emerald-100/60">
              INPE — Programa Queimadas, {format(new Date(`${g!.period.from}T12:00:00`), "dd/MM")} a {format(new Date(`${g!.period.to}T12:00:00`), "dd/MM")} · sincronizado em {format(new Date(g!.lastSyncAt!), "dd/MM/yyyy HH:mm")}
            </p>
          )}
        </div>

        <figure className="relative">
          {synced ? (
            <HotspotConstellation cells={g!.cells} states={g!.states} className="w-full" />
          ) : (
            <div className="aspect-square rounded-3xl border border-white/10 bg-white/5 flex items-center justify-center text-sm text-emerald-100/70 p-8 text-center">
              <Satellite className="w-6 h-6 mr-2" aria-hidden /> O mapa de focos aparece aqui após a primeira sincronização com o INPE.
            </div>
          )}
          <figcaption className="mt-3 text-xs text-emerald-100/65 flex items-start gap-2">
            <span className="mt-1 inline-block w-2.5 h-2.5 rounded-full bg-orange-400 shrink-0" aria-hidden />
            <span>Cada brilho reúne as detecções de satélite numa área de ~25 km nas últimas 48 h; pontos brancos são capitais, para referência.
              Foco de calor não é incêndio confirmado, e o mesmo fogo pode ser detectado por vários satélites.</span>
          </figcaption>
          {synced && (
            <table className="sr-only">
              <caption>Estados com mais detecções</caption>
              <thead><tr><th>UF</th><th>Detecções</th></tr></thead>
              <tbody>{g!.states.slice(0, 10).map((s) => <tr key={s.state}><td>{s.state}</td><td>{s.n}</td></tr>)}</tbody>
            </table>
          )}
        </figure>
      </div>
      <p className="relative border-t border-white/10 bg-black/20 text-xs sm:text-sm px-4 py-2.5 text-center text-orange-100 flex items-center justify-center gap-2">
        <Phone className="w-4 h-4 shrink-0" aria-hidden />{EMERGENCY_NOTICE}
      </p>
    </section>
  );
}

/** Illustrative preview of an analysis result (clearly labelled as an example). */
function AnalysisPreview() {
  const factors = [["Umidade relativa baixa", 20], ["Temperatura elevada", 15], ["Vegetação seca", 10], ["Chuva recente", -8]] as const;
  return (
    <div className="rounded-2xl bg-[#061A14] text-white p-5 shadow-inner" aria-hidden>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-emerald-200/70">Exemplo ilustrativo</span>
        <span className="text-xs text-emerald-100/70">Área · Fazenda exemplo</span>
      </div>
      <div className="flex items-center gap-5 mt-3">
        <svg viewBox="0 0 120 70" className="w-28 shrink-0">
          <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="10" strokeLinecap="round" />
          <path d="M10 62 A50 50 0 0 1 96 27" fill="none" stroke={riskLevelColor("alto")} strokeWidth="10" strokeLinecap="round" />
          <text x="60" y="58" textAnchor="middle" fontSize="22" fontWeight="700" fill="#fff">62</text>
        </svg>
        <div className="flex-1 space-y-1.5">
          {factors.map(([n, v]) => (
            <div key={n} className="text-[11px]">
              <div className="flex justify-between text-emerald-50/85"><span>{n}</span><span className="tabular-nums">{v > 0 ? `+${v}` : v}</span></div>
              <div className="h-1.5 rounded-full bg-white/10"><div className="h-1.5 rounded-full" style={{ width: `${Math.abs(v) * 4}%`, background: v > 0 ? "#fb923c" : "#34d399" }} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Illustrative preview of the public lookup (clearly labelled as an example). */
function LookupPreview() {
  const bars = [3, 5, 4, 8, 12, 9, 15, 11, 7, 5, 4, 2];
  return (
    <div className="rounded-2xl bg-[#061A14] text-white p-5" aria-hidden>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-emerald-200/70">Exemplo ilustrativo</span>
        <span className="text-xs text-emerald-100/70">Município · por mês</span>
      </div>
      <div className="mt-4 flex items-end gap-1.5 h-20">
        {bars.map((b, i) => <div key={i} className="flex-1 rounded-t bg-emerald-400/80" style={{ height: `${(b / 15) * 100}%` }} />)}
      </div>
      <div className="mt-3 flex gap-2 text-[11px]">
        <span className="rounded-full bg-white/10 px-2 py-0.5">UF</span><span className="rounded-full bg-white/10 px-2 py-0.5">Período</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5">Horário</span><span className="rounded-full bg-orange-400/20 text-orange-200 px-2 py-0.5">vs. período anterior</span>
      </div>
    </div>
  );
}

const STEPS = [
  { icon: CloudSun, title: "Dados com origem", desc: "Open-Meteo, INPE, importações da organização e o que você informa — cada valor marcado com a fonte." },
  { icon: Flame, title: "Índice 0–100", desc: "Motor de regras transparente. Se faltar dado, a análise pede — nunca inventa." },
  { icon: Info, title: "Explicação", desc: "Quanto cada fator pesou, fontes, qualidade dos dados e limitações." },
  { icon: Bell, title: "Alertas", desc: "Risco alto ou crítico vira alerta, sem duplicar, com responsável e histórico." },
  { icon: Map, title: "Mapa e relatórios", desc: "Áreas, ocorrências e focos no mapa; relatórios por período e CSV." },
  { icon: ShieldCheck, title: "Rastreabilidade", desc: "Versão do motor, fontes por análise e trilha de auditoria." },
];

const AUDIENCES = [
  { icon: Users, who: "Cidadãos", what: "Focos de calor e ocorrências por município, sem cadastro, com orientações de prevenção.", href: "/consulta-publica", cta: "Abrir consulta", tint: "from-orange-400/20" },
  { icon: Tractor, who: "Produtores rurais", what: "Risco da propriedade com clima e focos próximos, alertas e recomendações.", href: "/signup", cta: "Criar conta", tint: "from-emerald-400/20" },
  { icon: Building2, who: "Empresas e indústrias", what: "Várias unidades, históricos importados e equipes com papéis e permissões.", href: "/signup", cta: "Criar conta", tint: "from-sky-400/20" },
  { icon: GraduationCap, who: "Pesquisadores", what: "Séries publicadas e focos de calor com gráficos, comparação de períodos e CSV.", href: "/consulta-publica", cta: "Explorar dados", tint: "from-violet-400/20" },
  { icon: Landmark, who: "Gestores ambientais", what: "Áreas críticas, alertas, relatórios por período e publicação de dados.", href: "/signup", cta: "Criar conta", tint: "from-amber-400/20" },
  { icon: Settings2, who: "Administradores", what: "Membros, papéis e trilha de auditoria. Cada organização isolada das demais.", href: "/login", cta: "Entrar", tint: "from-slate-400/20" },
];

const LIMITS = [
  { icon: Phone, t: "Não é serviço de emergência", d: "Em caso de incêndio, ligue 193 (Bombeiros) ou 199 (Defesa Civil)." },
  { icon: AlertTriangle, t: "Índice ainda não calibrado", d: "Limiares documentados e transparentes; validação com incêndios reais prevista na Prova de Valor." },
  { icon: Satellite, t: "Foco de calor ≠ incêndio", d: "É uma detecção térmica; o mesmo fogo pode gerar várias detecções." },
  { icon: Upload, t: "Sisfogo: só dados públicos", d: "Lemos a API pública de ROIs finalizados do Ibama; sem convênio nem acesso privilegiado." },
  { icon: Database, t: "Modelo de ML experimental", d: "Treinado com dados sintéticos e desligado por padrão." },
  { icon: CloudSun, t: "Clima por modelo numérico", d: "Open-Meteo estima para a coordenada; não é estação local." },
];

const LEVELS: { level: RiskLevel; range: string }[] = [
  { level: "baixo", range: "0–24" }, { level: "moderado", range: "25–49" }, { level: "alto", range: "50–74" }, { level: "crítico", range: "75–100" },
];

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: connectors = [] } = useQuery<Connector[]>({ queryKey: ["/api/connectors"], queryFn: () => api("GET", "/api/connectors") });

  return (
    <div className="min-h-screen bg-[#F5F8F6] text-foreground">
      <PublicHeader />
      <main>
        <Hero />

        {/* Modules */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20" aria-labelledby="modulos">
          <Reveal>
            <p className="text-sm font-semibold text-primary">Uma plataforma, dois caminhos</p>
            <h2 id="modulos" className="text-3xl sm:text-4xl font-bold font-display mt-1 max-w-2xl">Do território da sua organização à consulta aberta para todos</h2>
          </Reveal>
          <div className="grid md:grid-cols-2 gap-6 mt-10">
            <Reveal>
              <article className="h-full rounded-3xl border bg-card p-6 sm:p-8 shadow-sm flex flex-col gap-5">
                <AnalysisPreview />
                <div>
                  <h3 className="text-2xl font-bold flex items-center gap-2"><Flame className="w-6 h-6 text-orange-500" aria-hidden />Análise Preditiva</h3>
                  <p className="text-muted-foreground mt-2">Cadastre áreas, analise o risco com clima e focos próximos, receba alertas e gere relatórios — com organizações isoladas e papéis de acesso.</p>
                </div>
                <Button className="w-fit mt-auto" onClick={() => setLocation("/signup")}>Criar conta <ArrowRight className="w-4 h-4 ml-1" aria-hidden /></Button>
              </article>
            </Reveal>
            <Reveal delay={120}>
              <article className="h-full rounded-3xl border bg-card p-6 sm:p-8 shadow-sm flex flex-col gap-5">
                <LookupPreview />
                <div>
                  <h3 className="text-2xl font-bold flex items-center gap-2"><Search className="w-6 h-6 text-emerald-600" aria-hidden />Consulta Pública</h3>
                  <p className="text-muted-foreground mt-2">Focos de calor do INPE e ocorrências publicadas por organizações, com filtros por município, período e horário — sem cadastro.</p>
                </div>
                <Button variant="outline" className="w-fit mt-auto" onClick={() => setLocation("/consulta-publica")}>Abrir a consulta <ArrowRight className="w-4 h-4 ml-1" aria-hidden /></Button>
              </article>
            </Reveal>
          </div>
        </section>

        {/* How it works */}
        <section id="como-funciona" className="bg-[#061A14] text-white py-20" aria-labelledby="como">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <Reveal>
              <p className="text-sm font-semibold text-emerald-300">Como funciona</p>
              <h2 id="como" className="text-3xl sm:text-4xl font-bold font-display mt-1 text-white">Da informação à decisão, sem caixa-preta</h2>
            </Reveal>
            <div className="relative mt-12">
            <div aria-hidden className="hidden lg:block absolute top-6 left-[8%] right-[8%] h-px bg-gradient-to-r from-emerald-400/0 via-emerald-400/50 to-orange-400/0" />
            <ol className="relative grid sm:grid-cols-2 lg:grid-cols-6 gap-6">
              {STEPS.map((s, i) => (
                <Reveal key={s.title} delay={i * 80} as="li" className="relative">
                  <div>
                    <span className="relative z-10 w-12 h-12 rounded-2xl bg-emerald-400/15 border border-emerald-300/30 flex items-center justify-center">
                      <s.icon className="w-5 h-5 text-emerald-300" aria-hidden />
                    </span>
                    <p className="mt-4 text-xs text-emerald-200/70 tabular-nums">Etapa {i + 1}</p>
                    <h3 className="font-semibold text-white">{s.title}</h3>
                    <p className="text-sm text-emerald-50/70 mt-1">{s.desc}</p>
                  </div>
                </Reveal>
              ))}
            </ol>
            </div>
            <Reveal>
              <div className="mt-12 rounded-2xl border border-white/10 bg-white/5 p-5 flex flex-col md:flex-row md:items-center gap-4">
                <p className="font-semibold text-white shrink-0">Níveis do índice</p>
                <ul className="flex flex-wrap gap-3">
                  {LEVELS.map((l) => <li key={l.level} className="flex items-center gap-2 rounded-full bg-white px-1 pr-3 py-0.5"><RiskBadge level={l.level} showIcon size="sm" /><span className="text-xs text-slate-700 tabular-nums">{l.range}</span></li>)}
                </ul>
                <p className="text-xs text-emerald-50/60 md:ml-auto md:max-w-sm">{DECISION_SUPPORT_DISCLAIMER}</p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Audiences */}
        <section id="para-quem" className="max-w-7xl mx-auto px-4 sm:px-6 py-20" aria-labelledby="quem">
          <Reveal>
            <p className="text-sm font-semibold text-primary">Para quem</p>
            <h2 id="quem" className="text-3xl sm:text-4xl font-bold font-display mt-1">Cada perfil vê o que precisa</h2>
          </Reveal>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
            {AUDIENCES.map((a, i) => (
              <Reveal key={a.who} delay={(i % 3) * 100} as="li" className={`h-full rounded-3xl border bg-gradient-to-br ${a.tint} to-white p-6 flex flex-col`}>
                <>
                  <span className="w-11 h-11 rounded-xl bg-white shadow-sm flex items-center justify-center"><a.icon className="w-5 h-5 text-primary" aria-hidden /></span>
                  <h3 className="font-bold text-lg mt-4">{a.who}</h3>
                  <p className="text-sm text-slate-700 mt-1 flex-1">{a.what}</p>
                  <Link href={a.href} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">{a.cta} <ArrowRight className="w-4 h-4" aria-hidden /></Link>
                </>
              </Reveal>
            ))}
          </ul>
        </section>

        {/* Data & limits */}
        <section id="dados" className="bg-white border-y py-20" aria-labelledby="dados-title">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-[1fr_1.2fr] gap-12">
            <Reveal>
              <p className="text-sm font-semibold text-primary">Transparência</p>
              <h2 id="dados-title" className="text-3xl sm:text-4xl font-bold font-display mt-1">De onde vêm os dados</h2>
              <ul className="mt-8 space-y-3">
                {connectors.map((c) => (
                  <li key={c.key} className="rounded-2xl border p-4 flex gap-3">
                    <span className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                      {c.key === "inpe-queimadas" ? <Satellite className="w-4 h-4 text-primary" aria-hidden /> : c.key === "open-meteo" ? <CloudSun className="w-4 h-4 text-primary" aria-hidden /> : c.key === "file-import" ? <Upload className="w-4 h-4 text-primary" aria-hidden /> : <Database className="w-4 h-4 text-primary" aria-hidden />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-xs text-slate-600 mt-0.5"><strong>{c.status}</strong>{c.lastSuccessAt && ` · sincronizado em ${format(new Date(c.lastSuccessAt), "dd/MM/yyyy HH:mm")}`}</p>
                    </div>
                  </li>
                ))}
                {connectors.length === 0 && <li className="text-sm text-muted-foreground">Carregando fontes…</li>}
              </ul>
            </Reveal>
            <Reveal delay={120}>
              <h2 className="text-3xl sm:text-4xl font-bold font-display">O que a plataforma não é</h2>
              <ul className="mt-8 grid sm:grid-cols-2 gap-3">
                {LIMITS.map((l) => (
                  <li key={l.t} className="rounded-2xl border bg-[#FFF8F1] border-orange-200/60 p-4">
                    <l.icon className="w-5 h-5 text-orange-600" aria-hidden />
                    <p className="font-semibold mt-2">{l.t}</p>
                    <p className="text-sm text-slate-700 mt-1">{l.d}</p>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* Privacy & maturity */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20 grid md:grid-cols-2 gap-6" aria-label="Privacidade e maturidade">
          <Reveal>
            <article className="h-full rounded-3xl border bg-card p-7">
              <Lock className="w-7 h-7 text-primary" aria-hidden />
              <h2 className="text-2xl font-bold mt-3">Privacidade por padrão</h2>
              <p className="text-slate-700 mt-2">Dados de cada organização isolados e auditados. Nada vai a público sem que um administrador publique — e então só com coordenadas aproximadas e sem observações internas.</p>
              <Link href="/privacidade" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">Política de privacidade (LGPD) <ArrowRight className="w-4 h-4" aria-hidden /></Link>
            </article>
          </Reveal>
          <Reveal delay={120}>
            <article className="h-full rounded-3xl border bg-card p-7">
              <FileText className="w-7 h-7 text-primary" aria-hidden />
              <h2 className="text-2xl font-bold mt-3">{TRL_LABEL}</h2>
              <p className="text-slate-700 mt-2">Protótipo funcional validado em ambiente controlado. Metas da Prova de Valor — <strong>ainda não alcançadas</strong>: reduzir em 30% o tempo de análise e obter validação de 80% dos alertas por especialistas.</p>
            </article>
          </Reveal>
        </section>

        {/* CTA */}
        <section id="contato" className="relative overflow-hidden bg-[#061A14] text-white" aria-labelledby="cta-title">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_50%,rgba(234,88,12,0.25),transparent_60%)]" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-16 flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div>
              <h2 id="cta-title" className="text-3xl sm:text-4xl font-bold font-display text-white">Participe da validação</h2>
              <p className="text-emerald-50/80 mt-2 max-w-xl">Produtores, empresas e gestores podem criar uma conta e cadastrar uma área piloto. O canal de contato institucional está em definição e será publicado aqui.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={() => setLocation("/signup")} className="rounded-xl bg-orange-400 px-6 py-3.5 font-semibold text-[#1c0a00] hover:bg-orange-300">Criar conta</button>
              <button onClick={() => setLocation("/simulacao")} className="rounded-xl border border-white/25 px-6 py-3.5 font-semibold text-white hover:bg-white/10">Simular uma análise</button>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#011410] text-emerald-100/70 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm">
          {SUBMISSION_MODE ? <ArtemisMark className="w-9 h-9" inverted /> : <img src="/brand/artemis-logo-dark.webp" alt="ARTEMIS AI — Inteligência para antecipar riscos" className="h-16 w-auto" loading="lazy" />}
          <nav className="flex flex-wrap justify-center gap-5" aria-label="Rodapé">
            <Link href="/consulta-publica" className="hover:text-white">Consulta pública</Link>
            <Link href="/simulacao" className="hover:text-white">Simular risco</Link>
            <Link href="/privacidade" className="hover:text-white">Privacidade</Link>
            <Link href="/login" className="hover:text-white">Entrar</Link>
          </nav>
          <p className="text-xs text-center">{PRODUCT_TAGLINE}<br />Dados: INPE — Programa Queimadas · Open-Meteo.com (CC BY 4.0)</p>
        </div>
      </footer>
    </div>
  );
}
