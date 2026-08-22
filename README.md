# Plataforma Preditiva de Inteligência Ambiental

**Preveja o risco. Proteja a operação.**

Plataforma preditiva para prevenção de incêndios em áreas produtivas e ativos territoriais.

---

## 1. Visão Geral

A plataforma integra dados ambientais, climáticos, geoespaciais e históricos para:

- classificar o risco de incêndio por área produtiva (score 0–100, 4 níveis);
- identificar e explicar os fatores críticos que contribuem para o risco;
- gerar alertas preventivos georreferenciados;
- recomendar ações antes da ocorrência;
- importar e tratar registros históricos de ocorrências;
- visualizar áreas e ocorrências em mapa interativo.

> **Estágio atual:** TRL 4 — Protótipo em validação controlada.
> Os dados utilizados são sintéticos, demonstrativos ou públicos.
> A validação operacional está prevista para a Prova de Valor.

---

## 2. Problema

Incêndios em áreas produtivas causam impactos ambientais, econômicos e operacionais relevantes. A ausência de sistemas preditivos integrados limita a capacidade de antecipação e resposta por parte de gestores de:

- agroindústrias;
- empresas florestais;
- unidades de energia;
- mineração;
- operações logísticas;
- instalações industriais;
- propriedades com ativos territoriais.

---

## 3. Solução

A plataforma demonstra o seguinte fluxo tecnológico:

```
Entrada de dados
→ Validação
→ Tratamento
→ Processamento (motor de risco ou modelo supervisionado)
→ Classificação de risco
→ Explicação dos fatores críticos
→ Recomendações preventivas
→ Geração de alerta
→ Visualização em mapa
→ Persistência
→ Geração de relatório
```

---

## 4. Evolução do projeto base

O CERES AI evolui a proposta original base ao incorporar:

- tratamento estruturado de registros históricos de incêndios;
- análise preditiva de risco com fatores explicáveis;
- visualização georreferenciada de ocorrências e áreas monitoradas;
- geração de alertas e recomendações preventivas;
- rastreabilidade completa das análises realizadas.

---

## 5. Setores Atendidos

Agroindústria · Empresas florestais · Energia · Mineração · Logística · Instalações industriais · Propriedades rurais

---

## 6. Funcionalidades

| Funcionalidade | Status |
|---|---|
| Análise preditiva de risco (formulário) | Implementado |
| Motor de regras transparente (determinístico) | Implementado |
| Modelo supervisionado Scikit-learn (RF) | Experimental — dataset sintético |
| Mapa de risco interativo (Leaflet) | Implementado |
| Alertas preventivos | Implementado |
| Áreas monitoradas (CRUD) | Implementado |
| Importação de ocorrências (CSV/XLS/XLSX) | Implementado |
| Tratamento e validação de registros | Implementado |
| Fontes de dados | Implementado — demonstrativo |
| Inteligência operacional (gráficos) | Implementado — demonstrativo |
| Protocolos de prevenção | Implementado |
| Relatórios | Implementado — demonstrativo |
| Tutorial de onboarding | Implementado |
| Modo de submissão anônima | Implementado |
| Autenticação (bcrypt + sessões) | Implementado |
| Fallback TypeScript quando Python indisponível | Implementado |
| Integração com sensores IoT reais | Prevista para a Prova de Valor |
| Integração com API Sisfogo em tempo real | Prevista para a Prova de Valor |
| Alertas via SMS/e-mail | Prevista para a Prova de Valor |

---

## 7. Arquitetura

```
Frontend React/TypeScript (Vite, porta 5000)
    ↓ HTTP
Backend Express/Node.js
    ↓ HTTP interno
Serviço Python/FastAPI (porta 8000)
    ↓
Motor Scikit-learn RF ou Motor de Regras Transparente
    ↓
PostgreSQL (Drizzle ORM)
```

---

## 8. Tecnologias

**Frontend:** React 18 · TypeScript 5.6 · Vite 7 · Tailwind CSS · shadcn/ui · Leaflet · Recharts · TanStack Query · Wouter

**Backend:** Node.js 20 · Express 4 · Drizzle ORM · bcrypt · PostgreSQL 16

**Camada analítica:** Python 3.12 · FastAPI · Scikit-learn · Pandas · NumPy · Pydantic · Joblib · Pytest

---

## 9. Como Executar

### Pré-requisitos

- Node.js 20+
- Python 3.12+
- PostgreSQL 16+

### Instalação

```bash
# Instalar dependências Node.js
npm install

# Instalar dependências Python
pip install -r python_service/requirements.txt
```

### Variáveis de Ambiente

| Variável | Descrição | Obrigatória |
|---|---|---|
| `DATABASE_URL` | URL de conexão com PostgreSQL | Sim |
| `SESSION_SECRET` | Segredo das sessões | Sim |
| `PYTHON_SERVICE_URL` | URL do FastAPI (padrão: http://127.0.0.1:8000) | Não |
| `VITE_SUBMISSION_MODE` | true = modo anônimo de submissão | Não |

### Executar

```bash
# Frontend + Backend Express (porta 5000)
npm run dev

# Serviço Python FastAPI (porta 8000)
cd python_service && uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

---

## 10. Serviço Python

```bash
# Treinar o modelo supervisionado
cd python_service && python train_model.py

# Avaliar o modelo
python evaluate_model.py

# Executar testes Python
pytest tests/ -v
```

**Endpoints:**

- `GET /health` — verificação de disponibilidade
- `POST /analyze-risk` — análise de risco

---

## 11. Machine Learning

O modelo supervisionado é um `RandomForestClassifier` (Scikit-learn) treinado com **dataset sintético** gerado pelo motor de regras.

> **AVISO:** As métricas abaixo foram obtidas com dataset sintético em ambiente controlado e **não representam desempenho operacional definitivo**.

| Métrica | Valor (dataset sintético) |
|---|---|
| Accuracy | 84.25% |
| F1 macro | 87.29% |
| F1 weighted | 84.37% |

A validação com dados reais está prevista para a Prova de Valor.

Quando o modelo não está disponível, o sistema usa automaticamente o motor de regras transparente como fallback.

---

## 12. Importação de Dados Históricos

A integração atual com dados do Sisfogo ocorre por **importação de arquivos autorizados** e **não representa conexão oficial ou direta por API**.

**Formatos suportados:** CSV, XLS, XLSX (até 10 MB)

**Fluxo:** upload → prévia → mapeamento de colunas → validação → persistência → visualização no mapa

**Status por registro:** válido · válido com ressalvas · inválido · duplicado

Nenhum registro é descartado silenciosamente.

---

## 13. Banco de Dados

| Tabela | Descrição |
|---|---|
| users | Usuários da plataforma |
| sensors | Sensores/estações |
| readings | Leituras dos sensores |
| alerts | Alertas preventivos |
| weather_data | Dados climáticos |
| monitored_areas | Áreas monitoradas |
| risk_analyses | Resultados de análises de risco |
| data_sources | Fontes de dados |
| import_batches | Lotes de importação |
| fire_occurrences | Ocorrências de incêndio importadas |

---

## 14. Testes

```bash
# Verificação TypeScript (0 erros)
npm run check

# Testes do motor de risco TypeScript (35 aprovados)
npm run test:risk

# Build de produção
npm run build

# Testes Python (104 aprovados)
pytest python_service/tests -v
```

---

## 15. Segurança

- Senhas com bcrypt (salt rounds: 10)
- Sessões httpOnly + sameSite
- Proteção de rotas (frontend + backend)
- Variáveis sensíveis via variáveis de ambiente
- Logs sem dados sensíveis
- Fallback Python não expõe erros internos

---

## 16. Dados Simulados

Os dados demonstrativos e sintéticos são claramente identificados na interface com:

- Label "Dados simulados para demonstração em ambiente controlado"
- Badge de tipo de modelo (supervised-ml / transparent-rule-engine)
- Campo `dataset_type` nas respostas da API
- Flag `is_simulated` em análises e alertas

---

## 17. Limitações

1. Dataset do modelo supervisionado é sintético — métricas não refletem desempenho operacional
2. Importação de ocorrências via arquivo (não API em tempo real)
3. Dados climáticos externos dependem de conectividade
4. Sem integração com sistemas de alerta externos (SMS, e-mail) nesta fase
5. A plataforma apoia decisões, mas **não substitui** laudos, inspeções ou protocolos oficiais

---

## 18. TRL 4

A solução encontra-se em **TRL 4** porque possui arquitetura definida, protótipo funcional e componentes integrados e testados em ambiente controlado. A versão atual demonstra entrada e processamento de dados, classificação de risco, visualização georreferenciada, importação de ocorrências, geração de alertas e recomendações.

A validação em ambiente operacionalmente relevante será realizada durante a **Prova de Valor**.

---

## 19. Prova de Valor

Metas previstas (não alcançadas nesta fase):

- Validação do modelo com dados reais de incêndios
- Retreinamento com dataset representativo (mínimo 500 ocorrências reais)
- Integração com fonte de dados climáticos em tempo real
- Validação operacional em área piloto
- Meta de F1 macro ≥ 80% com dados reais

---

## 20. Licença

Protótipo em desenvolvimento. Todos os direitos reservados.
