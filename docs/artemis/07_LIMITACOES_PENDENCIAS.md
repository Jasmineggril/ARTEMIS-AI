# 07 — Limitações, pendências e dependências

## Limitações científicas e de dados

1. **O índice não está calibrado.** Os limiares do motor de regras são documentados, mas não foram validados com incêndios reais da área. Nenhuma precisão operacional pode ser afirmada.
2. **O modelo supervisionado foi treinado com dados sintéticos** gerados pelo próprio motor de regras; suas métricas (accuracy 84,25 %, F1 macro 87,29 %) medem só a reprodução das regras, não a previsão de incêndios. Está desligado por padrão.
3. **Recomendações do nível crítico** ("paralisar operações", "evacuar pessoal", "acionar Defesa Civil") vêm do motor existente e são diretivas fortes para um índice não calibrado. **Requer revisão técnica por especialista em manejo do fogo antes de qualquer uso real.**
4. **Open-Meteo**: estimativa de modelo numérico, não medição local. Plano gratuito para uso não comercial — uso comercial exige revisar os termos. **O conector não foi verificado contra a API real** (rede bloqueada neste ambiente); só com respostas simuladas.
5. **Vegetação e foco próximo** são informados pelo usuário. Não há índice de vegetação por satélite nem focos de calor integrados.
6. **Sem integração oficial** com Sisfogo, INPE ou qualquer órgão público. A importação é manual.
7. Os contornos de biomas no mapa são retângulos ilustrativos, não os limites oficiais do IBGE. A tabela de referência de `client/src/lib/biomes.ts` (usada pelo assistente) classifica Recife, Salvador e Fortaleza como Caatinga, o que está incorreto para essas capitais litorâneas — substituir pela malha oficial de biomas do IBGE.
9. A **Consulta Pública** mostra apenas o que organizações escolheram publicar; ausência de registros não significa ausência de fogo. Publicar exige confirmação de direito de divulgação pelo administrador.
8. A camada de imagem `server.arcgisonline.com` (legado) tem termos de uso próprios — revisar antes de produção; o mapa novo usa OpenStreetMap.

## Pendências funcionais (por fase)

| Fase | Pendência | Dependência |
|---|---|---|
| 2 | E-mail de redefinição de senha e de alertas, com limite de frequência e registro de entrega | Provedor SMTP / conta |
| 2 | Relatório PDF gerado no servidor | — |
| 2 | Sensores/leituras e `weather_data` sem escopo de organização (restritos a `platform_admin` na escrita) | Decidir se sensores IoT permanecem no escopo |
| 2 | Painel de administração da plataforma (`/admin`) ainda é a tela legada de sensores | — |
| 3 | Consulta Pública: implementada com dados de lotes publicados pelas organizações. Pendente: fonte pública oficial (INPE/Sisfogo) com licença compatível; cobertura hoje depende de quem publica | Acesso e licença das fontes |
| 3 | Canal de relatos com moderação, anexos de imagem validados, anti-spam além do limite por IP (ex.: CAPTCHA), encaminhamentos | Validação jurídica e operacional |
| 3 | Mapa: agrupamento de pontos, busca por endereço/município (geocodificação), desenho de polígono, camadas de focos de calor | Licença do geocodificador; acesso INPE |
| 3 | Landing page: conteúdo ainda focado em áreas produtivas; apresentar perfis (cidadão, pesquisador, gestor) e revisar o modo escuro tela a tela | — |
| 4 | Registro de versões de modelo (`model_versions`), datasets, detecção de deriva, comparação entre versões | Dados reais rotulados |
| 4 | Módulo de Prova de Valor na interface | Área piloto definida |
| 4 | Teste de carga compatível com a VPS | VPS ou ambiente equivalente |
| 5 | Build das imagens Docker e subida do stack completo | Docker Hub respondeu HTTP 429 neste ambiente |
| 5 | CI (GitHub Actions) com os testes | Autorização para adicionar workflow |
| 5 | Limpeza periódica de tokens expirados e retenção de auditoria | Aprovação da política |

## Pendências de segurança e conformidade

- Auditoria manual de acessibilidade (leitor de tela, navegação só por teclado, tablet). O axe-core cobre apenas parte dos critérios WCAG.
- Revisão jurídica da política de privacidade (minuta) e do canal de relatos; nomeação do encarregado (DPO) e contato institucional.
- `xlsx@0.18.5` (SheetJS no npm) tem avisos de segurança conhecidos (prototype pollution / ReDoS) e não recebe correções no npm. Mitigação atual: o arquivo é processado **no navegador do próprio usuário**, não no servidor. Avaliar a versão oficial do CDN do SheetJS ou alternativa.
- Limitador de requisições em memória: adequado para um processo; com múltiplas réplicas, migrar para armazenamento compartilhado.
- Não há MFA.

## O que **não** foi feito por exigir autorização

Nenhuma compra, publicação, configuração de DNS, criação de VPS, envio de e-mail, abertura de pull request ou alteração de infraestrutura existente.
