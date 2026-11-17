import { Layout } from "@/components/Layout";
import { HelpCircle, BookOpen, BarChart3, Map, Bell, FileText, Database, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { PRODUCT_NAME, SUBMISSION_MODE } from "@shared/identity";

const sections = [
  {
    icon: BookOpen,
    title: "Como começar",
    content: (
      <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
        <li>Crie sua conta (ela cria a sua organização) ou entre com o convite recebido. Esqueceu a senha? Use "Esqueci minha senha" ou peça ao administrador da organização um link de acesso.</li>
        <li>Em <strong>Áreas Monitoradas</strong>, cadastre a propriedade: desenhe o limite no mapa ou importe o arquivo (GeoJSON, KML/KMZ ou o shapefile .zip do CAR). Área e coordenadas em branco são calculadas do polígono.</li>
        <li>Abra a propriedade para ver os focos de calor do INPE dentro e no entorno, o histórico oficial do Sisfogo e os alertas.</li>
        <li>Clique em <em>Analisar risco</em>: o clima vem do Open-Meteo e os focos do INPE são verificados automaticamente. Cada dado do resultado indica se é informado, estimado, observado ou calculado.</li>
        <li>Gere o <strong>Relatório</strong> (imprimir/salvar em PDF ou CSV) e acompanhe os <strong>Alertas Preventivos</strong>.</li>
      </ol>
    ),
  },
  {
    icon: Database,
    title: "Como cadastrar uma área",
    content: (
      <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
        <li>Navegue até <strong>Áreas Monitoradas</strong> no menu lateral.</li>
        <li>Clique em <em>Nova área</em> e preencha o nome, localização e tipo de operação.</li>
        <li>Informe as coordenadas geográficas ou selecione o município.</li>
        <li>Salve a área — ela ficará disponível nas análises e no mapa.</li>
      </ol>
    ),
  },
  {
    icon: BarChart3,
    title: "Como executar uma análise",
    content: (
      <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
        <li>Identifique a área e selecione o tipo de operação.</li>
        <li>Informe localização e tipo de uso do solo.</li>
        <li>Preencha os dados ambientais: temperatura, umidade, vento, precipitação.</li>
        <li>Selecione a condição da vegetação.</li>
        <li>Informe a existência de foco próximo e a distância estimada.</li>
        <li>Clique em <strong>Calcular risco</strong>.</li>
        <li>Consulte a classificação (0–100) e o nível de risco.</li>
        <li>Analise os fatores críticos que influenciaram o resultado.</li>
        <li>Leia as recomendações preventivas.</li>
        <li>Salve, gere um alerta ou emita um relatório.</li>
      </ol>
    ),
  },
  {
    icon: HelpCircle,
    title: "Como interpretar o índice de risco",
    content: (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">O índice vai de 0 a 100 e é dividido em quatro níveis:</p>
        <div className="space-y-2">
          {[
            { color: "#22c55e", label: "Baixo (0–24)", desc: "Condições favoráveis. Manter acompanhamento periódico." },
            { color: "#f59e0b", label: "Moderado (25–49)", desc: "Exige atenção e reforço das medidas preventivas." },
            { color: "#f97316", label: "Alto (50–74)", desc: "Requer inspeção prioritária e redução de atividades com potencial de ignição." },
            { color: "#ef4444", label: "Crítico (75–100)", desc: "Condição severa. Recomenda-se acionar imediatamente os protocolos de prevenção." },
          ].map(r => (
            <div key={r.label} className="flex items-start gap-3">
              <div className="w-3 h-3 rounded-full mt-0.5 shrink-0" style={{ background: r.color }} />
              <div>
                <span className="font-semibold text-foreground">{r.label}</span>
                <span className="text-muted-foreground"> — {r.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    icon: Map,
    title: "Como usar o mapa",
    content: (
      <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
        <li>Acesse <strong>Mapa de Risco</strong> no menu lateral.</li>
        <li>Cada marcador representa uma área monitorada com cor indicando o nível de risco.</li>
        <li>Clique em um marcador para ver detalhes: score, bioma, fatores críticos.</li>
        <li>Use os filtros para exibir apenas áreas de um nível específico.</li>
      </ul>
    ),
  },
  {
    icon: Bell,
    title: "Como acompanhar alertas",
    content: (
      <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
        <li>Acesse <strong>Alertas Preventivos</strong> no menu lateral.</li>
        <li>Cada alerta mostra o nível de severidade, área afetada e recomendação.</li>
        <li>Clique em <em>Resolver</em> para marcar o alerta como atendido.</li>
        <li>Alertas críticos ficam no topo da lista.</li>
      </ul>
    ),
  },
  {
    icon: FileText,
    title: "Como gerar relatórios",
    content: (
      <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
        <li>Acesse <strong>Relatórios</strong> no menu lateral.</li>
        <li>Selecione uma análise existente para visualizar o relatório completo.</li>
        <li>Use o botão <em>Imprimir</em> para exportar como PDF via diálogo do navegador.</li>
        <li>O relatório inclui: score, fatores críticos, recomendações e espaço para validação técnica.</li>
      </ul>
    ),
  },
  {
    icon: Database,
    title: "Diferença entre dados reais e simulados",
    content: (
      <div className="text-sm text-muted-foreground space-y-2">
        <p><strong className="text-foreground">Dados da organização:</strong> áreas, análises, alertas e ocorrências importadas são dados reais cadastrados pela sua organização e só ficam visíveis aos seus membros.</p>
        <p><strong className="text-foreground">Dados meteorológicos:</strong> quando ativado na análise, o Open-Meteo fornece estimativas de modelo numérico consultadas no momento da análise (não são medições de estação local nem monitoramento contínuo).</p>
        <p><strong className="text-foreground">Focos de calor (INPE):</strong> detecções térmicas por satélite, sincronizadas de hora em hora. Não são incêndios confirmados; o mesmo fogo pode gerar várias detecções.</p>
        <p><strong className="text-foreground">Registros oficiais (Sisfogo):</strong> ROIs finalizados publicados pelo Ibama/Prevfogo, sincronizados diariamente. Cobrem apenas os órgãos aderentes.</p>
        <p><strong className="text-foreground">Cenários demonstrativos:</strong> os botões "Cenário Baixo/Moderado/Alto/Crítico" da análise preenchem valores fictícios de teste e assim são identificados.</p>
      </div>
    ),
  },
  {
    icon: AlertTriangle,
    title: "Limitações da solução",
    content: (
      <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
        <li>Motor de classificação baseado em regras documentadas (TRL 4) — não é modelo supervisionado treinado.</li>
        <li>Limiares do motor documentados, mas ainda não calibrados com incêndios reais da sua área.</li>
        <li>Condição da vegetação é informada pelo usuário (não há índice de vegetação por satélite).</li>
        <li>Exportação de PDF pelo diálogo de impressão do navegador.</li>
        <li>Os resultados são instrumentos de apoio à decisão e não substituem laudo técnico oficial.</li>
        <li>Protótipo em validação controlada — TRL 4.</li>
      </ul>
    ),
  },
  {
    icon: CheckCircle2,
    title: "Perguntas frequentes",
    content: (
      <div className="space-y-4 text-sm">
        {[
          { q: "O sistema funciona sem conexão à internet?", a: "Não. A análise de risco e os dados climáticos requerem conexão. Um modo offline está previsto para a versão mobile (roadmap 2027)." },
          { q: "Os dados inseridos são armazenados?", a: "Sim, em banco PostgreSQL. As análises ficam registradas para geração de relatórios e histórico." },
          { q: "Como reiniciar o tutorial?", a: "Acesse Configurações e clique em Reiniciar tutorial de navegação." },
          { q: "O índice de risco é preciso?", a: "O motor atual usa regras documentadas baseadas em literatura técnica, não dados históricos reais. A precisão real será avaliada durante a Prova de Valor." },
        ].map(({ q, a }) => (
          <div key={q}>
            <p className="font-semibold text-foreground mb-1">{q}</p>
            <p className="text-muted-foreground">{a}</p>
          </div>
        ))}
      </div>
    ),
  },
];

function AccordionItem({ icon: Icon, title, content }: typeof sections[0]) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/50 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-5 hover:bg-secondary/30 transition-colors text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#e8f5e9", color: "#0F5132" }}>
            <Icon className="w-4 h-4" />
          </div>
          <span className="font-semibold text-foreground text-sm">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-border/30">
          <div className="pt-4">{content}</div>
        </div>
      )}
    </div>
  );
}

export default function Help() {
  const displayName = SUBMISSION_MODE ? "Plataforma Preditiva de Inteligência Ambiental" : PRODUCT_NAME;
  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary mb-2">Central de Ajuda</p>
          <h1 className="text-3xl font-bold font-display text-foreground">{displayName}</h1>
          <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
            Encontre respostas sobre como usar a plataforma, interpretar resultados e acompanhar áreas monitoradas.
          </p>
        </div>

        <div className="space-y-3">
          {sections.map(s => (
            <AccordionItem key={s.title} {...s} />
          ))}
        </div>
      </div>
    </Layout>
  );
}
