# ARTEMIS AI

**Inteligência para antecipar riscos. Tecnologia para proteger territórios.**

Plataforma brasileira de inteligência ambiental para prevenção de incêndios, análise preditiva de risco e apoio à decisão. Integra duas propostas anteriores, cuja história é preservada neste repositório:

- **CERES AI** — núcleo preditivo: índice de risco 0–100 explicável, alertas e recomendações (documentação TRL 4 em `docs/trl4/`).
- **Florestaí** — consulta pública e acessível de ocorrências de queimadas, prevenção e biomas (`/florestai`).

> **Estágio:** protótipo em validação controlada (TRL 4). **Não está pronto para produção.**
> O índice não está calibrado com incêndios reais. A plataforma apoia decisões humanas e **não é serviço de emergência** — em caso de incêndio ligue **193**.

## O que funciona hoje

| Módulo | Situação |
|---|---|
| Contas, organizações, 5 papéis, isolamento entre organizações, auditoria | Implementado e testado |
| Áreas monitoradas (coordenadas, polígono GeoJSON) | Implementado e testado |
| Análise de risco com procedência por variável, fontes, limitações e histórico | Implementado e testado |
| Motor de regras transparente (Python + espelho TypeScript como fallback) | Implementado e testado |
| Modelo Random Forest **experimental** (dataset sintético, desligado por padrão) | Experimental |
| Dados meteorológicos Open-Meteo sob demanda (nunca inventa valores) | Implementado; não verificado contra a API real |
| Alertas com ciclo de vida, histórico e deduplicação | Implementado e testado |
| Importação CSV/XLS/XLSX com revalidação no servidor | Implementado e testado |
| Mapa com áreas, polígonos e ocorrências filtráveis | Parcial |
| Consulta pública Florestaí (`/florestai`): só lotes publicados explicitamente, coordenadas ~1 km | Implementado e testado |
| Painel, relatório por área/período e indicadores agregados (fonte e data em cada bloco) | Implementado e testado |
| Exportação CSV | Implementado e testado |
| Docker Compose (Caddy + API + motor + PostgreSQL), backup cifrado | Backup/restauração testados; imagens não construídas aqui |

Situação completa dos 20 entregáveis: **[`docs/artemis/STATUS_ENTREGAVEIS.md`](docs/artemis/STATUS_ENTREGAVEIS.md)**.

## Documentação

| Documento | Conteúdo |
|---|---|
| [00 Diagnóstico](docs/artemis/00_DIAGNOSTICO.md) | O que existia, problemas encontrados e corrigidos |
| [01 Requisitos](docs/artemis/01_REQUISITOS.md) | Funcionais e não funcionais, com status |
| [02 Arquitetura](docs/artemis/02_ARQUITETURA.md) | Componentes, pastas, modelo de dados |
| [03 API](docs/artemis/03_API.md) | Rotas, papéis, esquemas |
| [04 Implantação Hostinger](docs/artemis/04_IMPLANTACAO_HOSTINGER.md) | VPS KVM 2 passo a passo |
| [05 Backup](docs/artemis/05_BACKUP_RECUPERACAO.md) | Política, agendamento, restauração testada |
| [06 Manual](docs/artemis/06_MANUAL.md) | Usuário e administrador |
| [07 Limitações](docs/artemis/07_LIMITACOES_PENDENCIAS.md) | Limitações científicas, pendências, dependências |
| [08 Prova de Valor](docs/artemis/08_PLANO_PROVA_DE_VALOR.md) | Plano de validação (metas, não resultados) |

## Desenvolvimento local

Pré-requisitos: Node 22+, Python 3.12+, PostgreSQL 16 (ou Docker).

```bash
docker compose -f docker-compose.dev.yml up -d
```

```bash
npm install --legacy-peer-deps && pip install -r python_service/requirements.txt
```

```bash
cp .env.example .env
```

Em `.env`, descomente `DATABASE_URL` da seção de desenvolvimento. Depois, em dois terminais:

```bash
npm run dev
```

```bash
npm run dev:python
```

Acesse `http://localhost:5000` e crie uma conta. Para dados de demonstração (rotulados "[DEMO]", bloqueados em produção):

```bash
DEMO_SEED_PASSWORD='escolhaUmaSenha1' npm run db:seed-demo
```

## Testes

| Comando | O que roda |
|---|---|
| `npm run check` | TypeScript (0 erros) |
| `npm test` | Motor de risco TS (34) + hash de senha (10) |
| `npm run test:unit` | Conector, procedência, alertas, segurança, CSV, GeoJSON, importação (14) |
| `TEST_DATABASE_URL=... npm run test:integration` | API completa contra PostgreSQL real, incl. isolamento entre organizações (30). **Apaga o banco de teste**; o nome precisa conter `test`. Com `TEST_PYTHON_URL` usa o FastAPI real. |
| `npm run test:python` | Serviço FastAPI (109) |
| `E2E_BASE_URL=... npm run test:e2e` | Fluxos no navegador, desktop e celular (12) |
| `E2E_BASE_URL=... E2E_DEMO_PASSWORD=... npm run test:a11y` | axe-core WCAG A/AA em 12 telas |

## Tecnologias

React 18 · TypeScript · Vite · Tailwind · shadcn/ui · Leaflet · Recharts · TanStack Query · Node 22 · Express · Drizzle ORM · PostgreSQL 16 · Python 3.12 · FastAPI · Scikit-learn · Docker Compose · Caddy

## Licença

Protótipo em desenvolvimento. Todos os direitos reservados. Componentes de terceiros mantêm suas licenças. Dados de mapa © colaboradores do OpenStreetMap. Dados meteorológicos: Open-Meteo.com (CC BY 4.0).
