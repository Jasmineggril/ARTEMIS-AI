# ARTEMIS AI — Sisfogo: Fontes Oficiais e Condições de Acesso

## 1. Responsável
- **Órgão:** Instituto Brasileiro do Meio Ambiente e dos Recursos Naturais Renováveis (Ibama).
- **Unidade de negócio:** Centro Nacional de Prevenção e Combate aos Incêndios Florestais (Prevfogo) — Coordenação de Monitoramento e Combate aos Incêndios Florestais.
- **Área técnica:** Coordenação-Geral de Tecnologia da Informação (CGTI) — Ibama.
- **Base legal:** Lei nº 14.944/2024 (Política Nacional de Manejo Integrado do Fogo e Sisfogo); Resolução COMIF nº 4/2025, Anexo III.

## 2. Fonte oficial confirmada
- **API pública (somente leitura):** Registro de Ocorrência de Incêndio Florestal (ROI).
- **Endpoint de produção:** `https://sisfogo.sistema.gov.br/api/v1/roi/publico`
- **Endpoint de homologação:** `https://sisfogo.hom.ibama.gov.br/api/v1/roi/publico`
- **Health check:** `https://sisfogo.sistema.gov.br/api/v1/roi/actuator/health/readiness`
- **Documentação OpenAPI (Swagger):** disponível no catálogo gov.br.
- **Manual consolidado:** PDF disponível no catálogo gov.br.

## 3. Autenticação e acesso
- **Não exige autenticação, token, chave de API, cadastro prévio, aprovação manual nem allowlist de IP.**
- Acesso aberto (API externa), conforme RN-API-006.
- **Rate limit:** 10 requisições/segundo (tolerância a picos de até 20 simultâneas). Acima disso: HTTP 429.
- **Paginação:** `page` (inicia em 1, padrão 1) e `size` (padrão 10, máximo 500 por página). Valores inválidos retornam 400.

## 4. Dados publicados
- Somente ROIs com status **FINALIZADO**.
- ROIs em andamento ou em retificação não aparecem até serem concluídos.
- Dados **anonimizados**: não expõe nome, CPF, e-mail, telefone, causa do incêndio, dificuldades no combate, observações, justificativas internas ou anexos.
- ROIs são exclusivos dos órgãos que aderiram ao Sisfogo.

## 5. Campos principais (ROI)
- Identificação: `id` (UUID), `numeroRoi`, `statusRoi`, `retificado`, instituição responsável, datas de criação/atualização.
- Local: `latitude`, `longitude`, município, UF, bioma, nome do local, Amazônia Legal, classificação da área (pública/particular/não identificada), tipo/subtipo de localidade.
- Datas do incêndio: início, detecção, deslocamento, primeiro ataque, controle, extinção.
- Combate: métodos de detecção, forma de extinção, quantitativo de brigadistas e combatentes por instituição, recursos humanos diários.
- Meios de locomoção diários.
- Pós-incêndio: vegetações atingidas, estruturas atingidas, estimativa de área queimada (ha).
- Frentes de combate: localização, instituição responsável, frente de referência.

## 6. Classificação
- **API oficial confirmada** — endpoint público, documentado, sem autenticação.
- **Download em massa:** não há endpoint de bulk download; a paginação é o mecanismo oficial de extração.
- **Acesso institucional:** não necessário para leitura dos ROIs finalizados.
- **Condições de uso:** dados públicos/anonimizados, transparência (Lei de Acesso à Informação, LGPD). Redistribuição deve preservar a anonimização e citar a fonte.

## 7. Periodicidade
- Atualização contínua conforme finalização de ROIs pelos órgãos aderentes.
- A API reflete apenas ROIs finalizados; não há garantia de tempo real.

## 8. Contatos oficiais
- Área de negócio: atendimento.sisfogo@ibama.gov.br — (61) 3316-1818 (horário comercial).
- Área técnica (CGTI): csi@ibama.gov.br — (61) 3316-1074 (horário comercial).

## 9. Limitações e cuidados
- Apenas ROIs finalizados (sem dados em andamento).
- Dados anonimizados (sem causa, observações, justificativas, anexos).
- Abrangência restrita aos órgãos que aderiram ao Sisfogo.
- Estimativa de área queimada é estimativa, não medição precisa.
- Coordenadas referem-se ao local do incêndio, não necessariamente ao polígono queimado.

## 10. Conclusão
A integração automática é **viável e autorizada** via API pública oficial, sem necessidade de credenciais. O conector deve respeitar o rate limit (10 req/s) e usar paginação (máx. 500 itens/página). Dados devem ser tratados como registros oficiais de incêndios (distintos de focos de satélite do INPE).