# 07 — Ficha do Sistema de IA — TRL 4

> Documento anonimizado. Para uso em avaliações de maturidade tecnológica.

---

## Identificação

| Campo | Valor |
|---|---|
| Nome do sistema | Plataforma Preditiva de Inteligência Ambiental |
| Versão | 1.0.0 |
| Estágio | TRL 4 — Protótipo em validação controlada |
| Data | Julho/2026 |
| Responsável técnico | Equipe de desenvolvimento (anonimizado) |

---

## Finalidade

Apoiar a tomada de decisão em prevenção de incêndios em áreas produtivas e ativos territoriais, por meio de:

- classificação do risco de incêndio (0–100, 4 níveis);
- identificação e explicação dos fatores críticos;
- geração de recomendações preventivas;
- importação e visualização de ocorrências históricas;
- alertas georreferenciados.

---

## Usuários Pretendidos

- Gestores de áreas produtivas (agroindústrias, empresas florestais, unidades de energia)
- Equipes de segurança e prevenção ambiental
- Analistas de risco territorial
- Coordenadores de defesa civil (uso futuro, previsto na PoV)

---

## Entradas do Sistema

| Entrada | Tipo | Obrigatória | Observação |
|---|---|---|---|
| Temperatura (°C) | Numérico | Sim | 0–60°C |
| Umidade relativa (%) | Numérico | Sim | 0–100% |
| Velocidade do vento (km/h) | Numérico | Sim | ≥0 |
| Precipitação recente (mm) | Numérico | Sim | ≥0 |
| Condição da vegetação | Categórico | Sim | úmida/regular/seca/muito seca |
| Foco próximo | Booleano | Não | Sim/Não |
| Distância do foco (km) | Numérico | Condicional | Se foco = sim |
| Histórico de ocorrências | Numérico | Não | Número de ocorrências |
| Qualidade dos dados | Categórico | Não | pobre/regular/boa/excelente |

---

## Saídas do Sistema

| Saída | Tipo | Descrição |
|---|---|---|
| score | 0–100 | Índice de risco de incêndio |
| level | Categórico | baixo / moderado / alto / crítico |
| confidence | 0–1 | Confiança da classificação |
| factors[] | Lista | Fatores com contribuição individual |
| recommendations[] | Lista | Ações preventivas por prioridade |
| model_type | Texto | supervised-ml ou transparent-rule-engine |
| model_version | Texto | Versão do motor utilizado |
| dataset_type | Texto | Tipo do dataset (sintético, etc.) |
| is_simulated | Booleano | Indica se a análise é simulada |
| calculated_at | Timestamp | Data e hora do cálculo |

---

## Modelo de IA

| Campo | Valor |
|---|---|
| Tipo | Classificação supervisionada |
| Algoritmo | RandomForestClassifier (Scikit-learn) |
| Status | Experimental — dataset sintético |
| Fallback | Motor de regras transparente (determinístico) |
| Explicabilidade | Alta — fatores e pesos documentados |

---

## Dados Utilizados

| Tipo | Origem | Limitação |
|---|---|---|
| Treinamento | Sintético (motor de regras) | Não representa ocorrências reais |
| Climáticos | Open-Meteo (público) + demonstrativos | Dados reais futuros na PoV |
| Históricos | Arquivo importado (CSV) | Não integração oficial com Sisfogo |
| Geoespaciais | Entrada manual + base geográfica | Sem geocodificação automática nesta fase |

---

## Limitações

1. O sistema **apoia** decisões, mas **não substitui** laudos técnicos, inspeções presenciais, fiscalização oficial ou protocolos internos de segurança.
2. O modelo supervisionado foi treinado com dados sintéticos — as métricas não representam desempenho operacional.
3. A importação de ocorrências ocorre via arquivo, não por API em tempo real.
4. A qualidade da análise depende diretamente da qualidade dos dados de entrada.
5. Sem conectividade, os dados climáticos podem estar desatualizados.

---

## Risco de Erro

| Cenário | Risco | Mitigação |
|---|---|---|
| Dados de entrada imprecisos | Alto — pode gerar classificação incorreta | Validação de entrada + indicador de qualidade |
| Foco não informado | Médio — subestima risco | Campo opcional com aviso |
| Dataset sintético no modelo | Alto — não generalize para dados reais | Motor de regras como fallback + aviso na tela |
| Serviço Python indisponível | Médio | Fallback automático para motor TypeScript |

---

## Supervisão Humana

O sistema **exige** supervisão humana em todas as decisões operacionais. A classificação de risco é um instrumento de apoio e deve ser interpretada por profissional qualificado antes de qualquer ação.

---

## Explicabilidade

Alta: cada análise retorna os fatores que influenciaram o risco, com contribuição quantificada de cada variável.

---

## Segurança e Privacidade

- Senhas armazenadas com bcrypt
- Sessões httpOnly
- Modo de submissão anônima (VITE_SUBMISSION_MODE) oculta dados identificadores
- Nenhum dado pessoal sensível processado na análise de risco

---

## Usos Pretendidos

✅ Apoio à decisão em prevenção de incêndios
✅ Identificação de áreas prioritárias para inspeção
✅ Visualização de ocorrências históricas georreferenciadas
✅ Planejamento de protocolos preventivos

---

## Usos Não Recomendados

❌ Substituição de laudos técnicos ou inspeções presenciais
❌ Uso como único critério para acionamento de equipes de combate a incêndios
❌ Apresentação das métricas do modelo como validação operacional
❌ Uso em contextos onde dados sintéticos são insuficientes
