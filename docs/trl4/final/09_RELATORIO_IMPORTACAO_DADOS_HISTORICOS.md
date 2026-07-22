# 09 — Relatório de Importação de Dados Históricos — TRL 4

---

## 1. Objetivo

Demonstrar o fluxo de importação, tratamento, validação e persistência de registros históricos de ocorrências de incêndio, evoluindo a proposta original do Florestaí de planilhas estáticas para um sistema integrado de análise de risco.

---

## 2. Origem no Florestaí

O Florestaí buscava transformar registros disponibilizados em planilhas estáticas em informações organizadas, filtráveis e úteis para tomada de decisão. No CERES AI, essa evolução ocorre por meio de um módulo dedicado de importação, tratamento, validação, georreferenciamento e visualização.

---

## 3. Fonte dos Dados

| Campo | Valor |
|---|---|
| Tipo de fonte | Arquivo CSV, XLS ou XLSX |
| Origem declarada | Sisfogo (quando aplicável) ou outras fontes autorizadas |
| Integração | Importação de arquivo — não representa conexão oficial ou direta por API |
| Dataset demonstrativo | public/demo-ocorrencias.csv (20 registros sintéticos) |

**Aviso obrigatório:** A integração atual ocorre por importação de arquivos autorizados e não representa conexão oficial ou direta por API com o Sisfogo.

---

## 4. Formatos Suportados

| Formato | Suportado | Observação |
|---|---|---|
| CSV (vírgula ou ponto-e-vírgula) | Sim | Parsing client-side |
| XLS | Sim | Via compatibilidade CSV |
| XLSX | Sim | Via compatibilidade CSV |
| Limite de tamanho | 10 MB | Validado no upload |

---

## 5. Fluxo de Importação

```
1. Seleção do arquivo (drag & drop ou seletor)
   ↓
2. Informação da fonte (campo livre)
   ↓
3. Parsing do arquivo (CSV → linhas e colunas)
   ↓
4. Detecção automática de colunas (autoMap por padrão de nome)
   ↓
5. Prévia das primeiras linhas (tabela interativa)
   ↓
6. Mapeamento manual de colunas (coluna do arquivo → campo do sistema)
   ↓
7. Validação por registro:
   - Data ausente ou inválida
   - Município ausente
   - Latitude/Longitude inválidas
   - Detecção de duplicidade
   ↓
8. Classificação de status: válido / com ressalvas / inválido / duplicado
   ↓
9. Relatório de validação (contagem + inconsistências)
   ↓
10. Confirmação pelo usuário
    ↓
11. Persistência no banco:
    - import_batches (1 registro por lote)
    - fire_occurrences (N registros por lote, exceto inválidos e duplicados)
    ↓
12. Relatório final do lote
```

---

## 6. Campos Aceitos

| Campo do sistema | Tipo | Obrigatório | Transformação |
|---|---|---|---|
| occurrenceDate | Texto | Sim | Normalizado AAAA-MM-DD ou DD/MM/AAAA |
| occurrenceTime | Texto | Não | Preservado como texto |
| municipality | Texto | Sim | Trim + normalização |
| state | Texto | Não | Trim + maiúsculas |
| latitude | Real | Não | Validação −90 a 90 |
| longitude | Real | Não | Validação −180 a 180 |
| occurrenceType | Texto | Não | Preservado |
| occurrenceStatus | Texto | Não | Preservado |
| affectedArea | Real | Não | Conversão numérica |
| cause | Texto | Não | Preservado |
| vegetationCondition | Texto | Não | Preservado |
| notes | Texto | Não | Preservado |
| source | Texto | Não | Preservado |
| sourceReference | Texto | Não | Preservado |

---

## 7. Tratamento de Dados

O sistema aplica automaticamente:

- Remoção de espaços em branco (trim)
- Normalização de separadores (vírgula ou ponto-e-vírgula)
- Remoção de aspas redundantes
- Conversão de valores numéricos (área, lat, lon)
- Detecção de campos ausentes
- Detecção de duplicidade por chave (data + município + coordenadas)
- Preservação do dado bruto (raw_data) para rastreabilidade

---

## 8. Status por Registro

| Status | Critério | Ação |
|---|---|---|
| válido | Todos os campos obrigatórios presentes e válidos | Importado |
| válido com ressalvas | Campos opcionais com problemas (ex.: coordenada inválida) | Importado com aviso |
| inválido | Campo obrigatório ausente ou inválido | Rejeitado |
| duplicado | Mesmo conjunto data+município+coords já existe no lote | Ignorado |

**Nenhum registro é descartado silenciosamente.** Todos recebem status e são registrados no banco com seu dado bruto original.

---

## 9. Rastreabilidade

Cada importação gera:

| Tabela | Dados registrados |
|---|---|
| import_batches | filename, fonte, total, válidos, inválidos, duplicados, data de importação |
| fire_occurrences | Todos os campos mapeados + status de validação + raw_data original |

---

## 10. Dataset Demonstrativo

Arquivo: `public/demo-ocorrencias.csv`

| Campo | Valor |
|---|---|
| Registros | 20 |
| Período | Julho/2024 a Abril/2025 |
| Municípios | Brasília/DF, Formosa/GO, Planaltina/DF, e outros |
| Estados | DF, GO |
| Fonte declarada | Sintético — para demonstração do fluxo |
| Identificação | Rotulado como demonstrativo |

Exemplo de lote importado:

| Lote | Fonte | Arquivo | Linhas | Válidas | Inválidas | Duplicadas | Status |
|---|---|---|---|---|---|---|---|
| 001 | Demonstrativo | demo-ocorrencias.csv | 20 | 20 | 0 | 0 | Concluído |

---

## 11. Integração com o Mapa

Ocorrências importadas com coordenadas válidas são exibidas como marcadores no Mapa de Risco (`/maps`), permitindo:

- Visualização georreferenciada de focos históricos
- Filtro por período, município, estado, tipo e fonte
- Clique para detalhes de cada ocorrência

---

## 12. Uso no Cálculo de Risco

O histórico de ocorrências é utilizado como **fator complementar** na análise de risco:

- O campo `historicalOccurrences` da análise captura a concentração de focos históricos próximos
- A contribuição é identificada explicitamente nos fatores retornados
- O histórico **não é o único fator** da classificação — é ponderado junto com dados climáticos e ambientais

---

## 13. Limitações

1. Importação via arquivo — sem API em tempo real com o Sisfogo
2. Geocodificação automática não implementada nesta fase — coordenadas devem estar no arquivo ou ser inseridas manualmente
3. Sem integração automática entre ocorrências importadas e análise de risco (usuário seleciona manualmente)
4. Dataset demonstrativo é sintético — não representa ocorrências reais

---

## 14. Conclusão

O módulo de importação de dados históricos demonstra o fluxo tecnológico completo previsto para TRL 4: do upload de arquivo à persistência validada e rastreável, com visualização no mapa e disponibilidade para uso na análise de risco. As limitações são documentadas e os avisos sobre não-integração oficial são exibidos na interface.
