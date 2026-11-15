# 06 — Manual do usuário e do administrador

> A ARTEMIS AI apoia decisões; não substitui inspeção, laudo técnico, profissionais habilitados nem protocolos oficiais. **Não é serviço de emergência: em caso de incêndio ligue 193 (Bombeiros) ou 199 (Defesa Civil).**

## Parte A — Usuário

### Criar conta e entrar
1. Em **Criar conta**, informe nome, e-mail, senha (8+ caracteres, letras e números) e, se quiser, o nome da organização e o perfil.
2. Aceite a política de privacidade. Uma organização é criada e você se torna o **proprietário**.
3. Esqueceu a senha? **Esqueci minha senha** gera um link válido por 30 minutos, de uso único.

### Papéis
| Papel | Pode |
|---|---|
| Leitor | consultar áreas, análises, alertas, mapa e painel |
| Analista | + executar análises, tratar alertas, exportar CSV |
| Gestor | + cadastrar/editar áreas e importar ocorrências |
| Administrador | + remover áreas, gerenciar membros, ver auditoria |
| Proprietário | + conceder o papel de proprietário |

### Cadastrar uma área
**Áreas Monitoradas → Nova área.** Obrigatórios: nome, atividade, município e UF. Recomendado: latitude e longitude (necessárias para dados meteorológicos automáticos e para contar ocorrências próximas). Opcional: limite em GeoJSON (cole o texto ou importe `.geojson`; coordenadas em longitude, latitude).

### Analisar o risco
1. Em **Análise de Risco**, escolha a área.
2. Marque **Preencher campos meteorológicos vazios com dados do Open-Meteo** para que temperatura, umidade, vento e chuva de 72 h venham da fonte. Valores digitados sempre prevalecem.
3. Informe a condição da vegetação e se há foco próximo conhecido.
4. Deixe "Ocorrências históricas" vazio para usar as ocorrências importadas a até 10 km.
5. **Analisar e registrar.**

O resultado mostra o índice (0–100) e o nível: **baixo** 0–24, **moderado** 25–49, **alto** 50–74, **crítico** 75–100 — sempre com texto e símbolo, não só cor. Leia também:
- **Fatores** — quanto cada condição somou ou subtraiu.
- **Fontes e procedência** — de onde veio cada variável.
- **Limitações e incertezas** — leia antes de agir.
- Se o resultado indicar **experimental**, ele veio do modelo treinado com dados sintéticos: não use como base operacional.

Se a fonte meteorológica falhar, a análise **não** é feita com valores inventados: o sistema pede os dados manualmente.

**Simulação** (sem login): mesma lógica, resultado não é salvo.

### Alertas
Análises **alto** ou **crítico** emitem alerta. Uma nova análise no mesmo nível atualiza o alerta aberto (contador "N×") em vez de criar outro. Abra o alerta para ver o motivo, as recomendações e o histórico, e registrar ações: **Reconhecido → Em acompanhamento → Resolvido**, ou **Descartar** (com motivo obrigatório).

### Importar ocorrências históricas
**Importação de Ocorrências:** envie CSV, XLS ou XLSX (até 10 MB) → confira a prévia e o mapeamento de colunas → revise válidos, com ressalvas, inválidos e duplicados → confirme. Datas aceitas: `AAAA-MM-DD` ou `DD/MM/AAAA`. Nenhum registro é descartado em silêncio: o relatório do lote mostra os motivos. A importação **não** é integração oficial com o Sisfogo.

### Mapa
Camadas de áreas (cor + legenda por nível), ocorrências importadas e biomas (contorno ilustrativo, não oficial). Filtre ocorrências por período, UF e município e exporte o resultado em CSV. As ocorrências são registros históricos, não monitoramento em tempo real.

## Parte B — Administrador

### Membros
**Organização → Membros.** Adicione pelo e-mail de quem **já tem conta**, escolha o papel, altere ou remova. O acesso é verificado em toda requisição: quem é removido perde o acesso imediatamente.

### Auditoria
**Organização → Trilha de auditoria** lista login, cadastro, criação/edição/remoção de áreas, análises, mudanças de alerta, importações, exportações e mudanças de membros, com usuário e data/hora. Senhas e tokens nunca são registrados.

### Operação técnica
- Implantação: `04_IMPLANTACAO_HOSTINGER.md` · Backups: `05_BACKUP_RECUPERACAO.md`
- Saúde: `GET /api/health`
- Variáveis: `.env.example` (o servidor não inicia em produção sem `SESSION_SECRET` forte)
- Motor experimental: `RISK_ENGINE_MODE=ml-experimental` — **não** ative em operação real antes de validar com dados reais.
- Limite de alerta: `ALERT_MIN_LEVEL` (padrão `alto`).
- Dados demonstrativos: `DEMO_SEED_PASSWORD=... npm run db:seed-demo` (bloqueado em produção; tudo rotulado "[DEMO]").
