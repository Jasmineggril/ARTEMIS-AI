import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  Flame, Map, Bell, Database, FileText, ShieldCheck, Users, Search, Building2, Tractor,
  GraduationCap, Landmark, Settings2, User, LogOut, Satellite, CloudSun, Upload, Info, Phone, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/RiskBadge";
import { ArtemisMark } from "@/components/ArtemisMark";
import { useAuthStatus, useLogout } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import {
  PRODUCT_NAME, PRODUCT_TAGLINE, SUBMISSION_MODE, TRL_LABEL, EMERGENCY_NOTICE, DECISION_SUPPORT_DISCLAIMER,
} from "@shared/identity";
import type { RiskLevel } from "@shared/risk-engine";

interface HotspotSummary { total: number; bySatellite: { satellite: string; n: number }[]; lastSyncAt: string | null; period: { from: string; to: string } }
interface Connector { key: string; name: string; status: string; note: string; lastSuccessAt?: string | null }

function PublicHeader() {
  const { data: user } = useAuthStatus();
  const logout = useLogout();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/40 bg-card/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5">
          <ArtemisMark className="w-9 h-9 shrink-0" />
          {!SUBMISSION_MODE && <span className="font-bold text-base text-foreground">{PRODUCT_NAME}</span>}
        </Link>
        <nav className="hidden lg:flex items-center gap-6 text-sm text-muted-foreground" aria-label="Seções">
          <a href="/consulta-publica" className="hover:text-foreground font-semibold text-foreground">Consulta pública</a>
          <a href="#como-funciona" className="hover:text-foreground">Como funciona</a>
          <a href="#para-quem" className="hover:text-foreground">Para quem</a>
          <a href="#dados" className="hover:text-foreground">Dados e limites</a>
          <a href="#contato" className="hover:text-foreground">Contato</a>
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <div className="relative">
              <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-secondary/50 text-sm">
                <User className="w-4 h-4" aria-hidden /><span className="hidden sm:block font-medium">{user.name}</span>
              </button>
              {open && (
                <div className="absolute right-0 mt-2 w-44 bg-card border rounded-lg shadow-lg overflow-hidden z-50">
                  <button onClick={() => setLocation("/dashboard")} className="w-full text-left px-4 py-2 hover:bg-secondary/50 text-sm">Painel</button>
                  <button onClick={() => logout.mutate()} className="w-full text-left px-4 py-2 hover:bg-destructive/10 text-sm text-destructive flex items-center gap-2">
                    <LogOut className="w-4 h-4" aria-hidden /> Sair
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

function LiveIndicators() {
  const { data: hot, isLoading } = useQuery<HotspotSummary>({
    queryKey: ["/api/public/hotspots/summary", "home"], queryFn: () => api("GET", "/api/public/hotspots/summary"),
  });
  return (
    <aside className="bg-white/10 border border-white/20 rounded-2xl p-5 backdrop-blur-sm" aria-labelledby="live-title">
      <p id="live-title" className="text-xs uppercase tracking-wider text-emerald-200 font-semibold flex items-center gap-1.5">
        <Satellite className="w-4 h-4" aria-hidden /> Focos de calor no Brasil — INPE
      </p>
      {isLoading ? (
        <p className="text-sm text-emerald-100 mt-3">Carregando…</p>
      ) : !hot || !hot.lastSyncAt ? (
        <p className="text-sm text-emerald-100 mt-3">A sincronização com o INPE ainda não foi realizada neste ambiente. Nenhum número é exibido até lá.</p>
      ) : (
        <>
          <p className="text-4xl font-bold mt-2 tabular-nums">{hot.total.toLocaleString("pt-BR")}</p>
          <p className="text-sm text-emerald-100">detecções por satélite entre {format(new Date(`${hot.period.from}T12:00:00`), "dd/MM")} e {format(new Date(`${hot.period.to}T12:00:00`), "dd/MM")}</p>
          <p className="text-xs text-emerald-200 mt-3">
            Última sincronização: {format(new Date(hot.lastSyncAt), "dd/MM/yyyy HH:mm")}. Foco de calor não é incêndio confirmado, e o mesmo fogo pode ser detectado por vários satélites.
          </p>
        </>
      )}
      <Link href="/consulta-publica" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-white underline underline-offset-4">
        Ver no mapa e filtrar por município <ChevronRight className="w-4 h-4" aria-hidden />
      </Link>
    </aside>
  );
}

const STEPS = [
  { icon: CloudSun, title: "Reúne dados com origem identificada", desc: "Clima do Open-Meteo, focos de calor do INPE, ocorrências importadas pela sua organização e o que você informa — cada valor fica marcado com a fonte." },
  { icon: Flame, title: "Calcula um índice de 0 a 100", desc: "Motor de regras transparente, com limiares documentados. Nada é preenchido com valores inventados: se faltar dado, a análise pede." },
  { icon: Info, title: "Explica o resultado", desc: "Quanto cada fator somou ou subtraiu, as fontes usadas, a qualidade dos dados e as limitações da análise." },
  { icon: Bell, title: "Emite e acompanha alertas", desc: "Alertas para risco alto ou crítico, sem duplicar, com responsável, histórico e motivo de cada mudança." },
  { icon: Map, title: "Mostra no mapa e em relatórios", desc: "Áreas, polígonos, ocorrências e focos de calor; relatórios por período com exportação CSV e impressão." },
  { icon: ShieldCheck, title: "Registra tudo", desc: "Cada análise guarda a versão do motor e as fontes; operações críticas ficam na trilha de auditoria." },
];

const AUDIENCES = [
  { icon: Users, who: "Cidadãos", what: "Consultar focos de calor e ocorrências por município, período e horário, e orientações de prevenção — sem precisar de conta.", href: "/consulta-publica", cta: "Abrir consulta" },
  { icon: Tractor, who: "Produtores rurais", what: "Cadastrar a propriedade, analisar o risco com dados do clima e de focos próximos e receber alertas com recomendações.", href: "/signup", cta: "Criar conta" },
  { icon: Building2, who: "Empresas e indústrias", what: "Monitorar várias unidades, importar históricos de ocorrências e organizar equipes com papéis e permissões.", href: "/signup", cta: "Criar conta" },
  { icon: GraduationCap, who: "Pesquisadores", what: "Séries de ocorrências publicadas e focos de calor com gráficos, comparação de períodos e exportação CSV.", href: "/consulta-publica", cta: "Explorar dados" },
  { icon: Landmark, who: "Gestores ambientais", what: "Acompanhar áreas críticas, tratar alertas, gerar relatórios por período e publicar dados para consulta pública.", href: "/signup", cta: "Criar conta" },
  { icon: Settings2, who: "Administradores", what: "Gerenciar membros e papéis da organização e consultar a trilha de auditoria. Dados de cada organização ficam isolados.", href: "/login", cta: "Entrar" },
];

const LEVELS: { level: RiskLevel; range: string }[] = [
  { level: "baixo", range: "0–24" }, { level: "moderado", range: "25–49" }, { level: "alto", range: "50–74" }, { level: "crítico", range: "75–100" },
];

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: connectors = [] } = useQuery<Connector[]>({ queryKey: ["/api/connectors"], queryFn: () => api("GET", "/api/connectors") });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />
      <p className="bg-red-50 text-red-900 border-b border-red-200 text-xs sm:text-sm px-4 py-2 text-center flex items-center justify-center gap-2">
        <Phone className="w-4 h-4 shrink-0" aria-hidden />{EMERGENCY_NOTICE}
      </p>

      <main>
        {/* Hero */}
        <section className="bg-gradient-to-br from-[#0B3D2E] via-[#0F5132] to-[#0B2F4A] text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 md:py-20 grid lg:grid-cols-[1.4fr_1fr] gap-10 items-center">
            <div>
              <p className="text-emerald-200 text-sm font-semibold mb-3">Inteligência ambiental para prevenção de incêndios</p>
              <h1 className="text-4xl md:text-5xl font-bold font-display leading-tight text-white">{PRODUCT_TAGLINE}</h1>
              <p className="text-emerald-50 text-lg mt-5 max-w-2xl">
                A {PRODUCT_NAME} reúne dados climáticos, focos de calor por satélite e históricos de ocorrências para classificar o risco de incêndio,
                explicar o porquê e apoiar decisões preventivas — com a origem de cada dado sempre visível.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mt-8">
                <Button size="lg" className="bg-white text-[#0F5132] hover:bg-emerald-50" onClick={() => setLocation("/consulta-publica")}>
                  <Search className="w-5 h-5 mr-2" aria-hidden />Consultar focos e ocorrências
                </Button>
                <Button size="lg" variant="outline" className="border-white/60 bg-transparent text-white hover:bg-white/10" onClick={() => setLocation("/signup")}>
                  Monitorar minhas áreas
                </Button>
              </div>
              <p className="text-xs text-emerald-200 mt-4">{TRL_LABEL}. Uso gratuito durante a validação.</p>
            </div>
            <LiveIndicators />
          </div>
        </section>

        {/* Modules */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16" aria-labelledby="modulos">
          <h2 id="modulos" className="text-3xl font-bold font-display mb-8">Dois módulos, uma plataforma</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <article className="rounded-2xl border bg-card p-6">
              <Flame className="w-8 h-8 text-primary mb-3" aria-hidden />
              <h3 className="text-xl font-bold">Análise Preditiva</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">Para quem precisa proteger áreas produtivas e territórios. Requer conta.</p>
              <ul className="text-sm space-y-2 list-disc list-inside">
                <li>Áreas monitoradas com coordenadas e limite geográfico (GeoJSON)</li>
                <li>Índice de risco 0–100 com fatores, fontes e limitações</li>
                <li>Focos de calor do INPE próximos considerados automaticamente quando atualizados</li>
                <li>Alertas com ciclo de vida, relatórios por período e exportação CSV</li>
                <li>Organizações isoladas, cinco papéis de acesso e auditoria</li>
              </ul>
            </article>
            <article className="rounded-2xl border bg-card p-6">
              <Search className="w-8 h-8 text-primary mb-3" aria-hidden />
              <h3 className="text-xl font-bold">Consulta Pública</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">Aberta a qualquer pessoa, sem cadastro.</p>
              <ul className="text-sm space-y-2 list-disc list-inside">
                <li>Focos de calor do INPE por UF, município e satélite</li>
                <li>Ocorrências históricas publicadas por organizações, com quem publicou</li>
                <li>Filtros por período e horário, gráficos e comparação com o período anterior</li>
                <li>Link compartilhável e orientações de prevenção e segurança</li>
              </ul>
              <Button className="mt-5" onClick={() => setLocation("/consulta-publica")}>Abrir a consulta</Button>
            </article>
          </div>
        </section>

        {/* How it works */}
        <section id="como-funciona" className="bg-muted/30 border-y py-16" aria-labelledby="como">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <h2 id="como" className="text-3xl font-bold font-display mb-8">Como funciona</h2>
            <ol className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-2xl border bg-card p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center" aria-hidden>{i + 1}</span>
                    <s.icon className="w-5 h-5 text-primary" aria-hidden />
                  </div>
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{s.desc}</p>
                </li>
              ))}
            </ol>
            <div className="mt-8 rounded-2xl border bg-card p-5">
              <h3 className="font-semibold mb-3">Níveis do índice de risco</h3>
              <ul className="flex flex-wrap gap-4">
                {LEVELS.map((l) => <li key={l.level} className="flex items-center gap-2"><RiskBadge level={l.level} showIcon /> <span className="text-sm text-muted-foreground tabular-nums">{l.range}</span></li>)}
              </ul>
              <p className="text-xs text-muted-foreground mt-3">{DECISION_SUPPORT_DISCLAIMER}</p>
            </div>
          </div>
        </section>

        {/* Audiences */}
        <section id="para-quem" className="max-w-7xl mx-auto px-4 sm:px-6 py-16" aria-labelledby="quem">
          <h2 id="quem" className="text-3xl font-bold font-display mb-8">Para quem</h2>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {AUDIENCES.map((a) => (
              <li key={a.who} className="rounded-2xl border bg-card p-5 flex flex-col">
                <a.icon className="w-7 h-7 text-primary mb-2" aria-hidden />
                <h3 className="font-semibold">{a.who}</h3>
                <p className="text-sm text-muted-foreground mt-1 flex-1">{a.what}</p>
                <Link href={a.href} className="mt-4 text-sm font-semibold text-primary underline underline-offset-4">{a.cta}</Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Data and limits */}
        <section id="dados" className="bg-muted/30 border-y py-16" aria-labelledby="dados-title">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-8">
            <div>
              <h2 id="dados-title" className="text-3xl font-bold font-display mb-6">Fontes de dados</h2>
              <ul className="space-y-3">
                {connectors.map((c) => (
                  <li key={c.key} className="rounded-xl border bg-card p-4">
                    <p className="font-semibold flex items-center gap-2">
                      {c.key === "inpe-queimadas" ? <Satellite className="w-4 h-4 text-primary" aria-hidden /> : c.key === "open-meteo" ? <CloudSun className="w-4 h-4 text-primary" aria-hidden /> : c.key === "file-import" ? <Upload className="w-4 h-4 text-primary" aria-hidden /> : <Database className="w-4 h-4 text-primary" aria-hidden />}
                      {c.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1"><strong>{c.status}</strong>{c.lastSuccessAt && ` · última sincronização ${format(new Date(c.lastSuccessAt), "dd/MM/yyyy HH:mm")}`}</p>
                    <p className="text-sm text-muted-foreground mt-1">{c.note}</p>
                  </li>
                ))}
                {connectors.length === 0 && <li className="text-sm text-muted-foreground">Carregando fontes…</li>}
              </ul>
            </div>
            <div>
              <h2 className="text-3xl font-bold font-display mb-6">Limites que você deve conhecer</h2>
              <ul className="space-y-3 text-sm">
                <li className="rounded-xl border bg-card p-4"><strong>Não é serviço de emergência.</strong> Em caso de incêndio, ligue 193 (Bombeiros) ou 199 (Defesa Civil).</li>
                <li className="rounded-xl border bg-card p-4"><strong>O índice ainda não foi calibrado com incêndios reais.</strong> Os limiares são documentados e transparentes, mas a validação em campo está prevista para a Prova de Valor.</li>
                <li className="rounded-xl border bg-card p-4"><strong>Foco de calor não é incêndio confirmado.</strong> É uma detecção térmica por satélite; o mesmo fogo pode gerar várias detecções.</li>
                <li className="rounded-xl border bg-card p-4"><strong>Não há integração oficial com o Sisfogo.</strong> Históricos entram por importação de arquivos autorizados.</li>
                <li className="rounded-xl border bg-card p-4"><strong>O modelo de aprendizado de máquina é experimental</strong> (treinado com dados sintéticos) e fica desligado por padrão.</li>
                <li className="rounded-xl border bg-card p-4"><strong>Clima por modelo numérico.</strong> Os dados do Open-Meteo são estimativas para a coordenada, não medições de estação local.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Privacy & maturity */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 grid md:grid-cols-2 gap-6" aria-label="Privacidade e maturidade">
          <article className="rounded-2xl border bg-card p-6">
            <ShieldCheck className="w-7 h-7 text-primary mb-2" aria-hidden />
            <h2 className="text-xl font-bold">Privacidade e segurança</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Senhas com hash, sessões protegidas, dados de cada organização isolados e auditoria de operações críticas.
              Nada vai a público sem que um administrador publique explicitamente — e, quando publica, as coordenadas são aproximadas e observações ficam de fora.
            </p>
            <Link href="/privacidade" className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-4">Política de privacidade (LGPD)</Link>
          </article>
          <article className="rounded-2xl border bg-card p-6">
            <FileText className="w-7 h-7 text-primary mb-2" aria-hidden />
            <h2 className="text-xl font-bold">Maturidade: {TRL_LABEL}</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Protótipo funcional validado em ambiente controlado. A Prova de Valor tem como <strong>metas</strong> — ainda não alcançadas — reduzir em pelo menos 30%
              o tempo de análise e obter validação de 80% dos alertas e recomendações por especialistas.
            </p>
          </article>
        </section>

        {/* Contact */}
        <section id="contato" className="bg-gradient-to-r from-[#0B3D2E] to-[#0F5132] text-white py-14" aria-labelledby="contato-title">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h2 id="contato-title" className="text-2xl md:text-3xl font-bold font-display text-white">Quer participar da validação?</h2>
              <p className="text-emerald-100 mt-2 max-w-2xl">
                Produtores, empresas e gestores podem criar uma conta e cadastrar uma área piloto. O canal de contato institucional está em definição e será publicado aqui.
              </p>
            </div>
            <div className="flex gap-3">
              <Button size="lg" className="bg-white text-[#0F5132] hover:bg-emerald-50" onClick={() => setLocation("/signup")}>Criar conta</Button>
              <Button size="lg" variant="outline" className="border-white/60 bg-transparent text-white hover:bg-white/10" onClick={() => setLocation("/simulacao")}>Simular uma análise</Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2"><ArtemisMark className="w-7 h-7" />{!SUBMISSION_MODE && <span className="font-medium text-foreground">{PRODUCT_NAME}</span>}</div>
          <nav className="flex flex-wrap gap-4" aria-label="Rodapé">
            <Link href="/consulta-publica" className="hover:underline">Consulta pública</Link>
            <Link href="/simulacao" className="hover:underline">Simular risco</Link>
            <Link href="/privacidade" className="hover:underline">Privacidade</Link>
            <Link href="/login" className="hover:underline">Entrar</Link>
          </nav>
          <p className="text-xs">Dados: INPE — Programa Queimadas · Open-Meteo.com (CC BY 4.0) · © colaboradores do OpenStreetMap</p>
        </div>
      </footer>
    </div>
  );
}
