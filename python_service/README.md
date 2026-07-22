# CERES AI — Python Risk Analysis Service

Serviço Python (FastAPI) responsável pelo processamento analítico de risco de incêndio.

## Por que Python foi adicionado?

O Python complementa a stack Node.js/TypeScript existente com uma camada analítica
preparada para evolução para Machine Learning supervisionado (Scikit-learn) durante
a Prova de Valor. O Express não é substituído — ele permanece como gateway e orquestrador.

## Arquitetura

```
Frontend React/TypeScript
  → Backend Express (Node.js)
    → Serviço Python FastAPI (porta 8000)
      → Motor de regras / modelo Scikit-learn
    → Banco PostgreSQL
```

## Endpoints

| Método | Rota           | Descrição                     |
|--------|----------------|-------------------------------|
| GET    | `/health`      | Status do serviço             |
| POST   | `/analyze-risk`| Análise de risco de incêndio  |

### POST /analyze-risk — Payload de entrada

```json
{
  "temperature": 38,
  "humidity": 28,
  "wind_speed": 28,
  "recent_rainfall": 0,
  "vegetation_condition": "dry",
  "nearby_hotspot": true,
  "hotspot_distance": 20,
  "historical_occurrences": 3,
  "data_quality": "good"
}
```

### Resposta

```json
{
  "score": 62,
  "level": "alto",
  "confidence": 0.9,
  "factors": [...],
  "recommendations": [...],
  "model_type": "transparent-rule-engine",
  "model_version": "1.0.0-rules",
  "is_simulated": false,
  "calculated_at": "2026-07-17T22:00:00+00:00"
}
```

## Como executar

```bash
cd python_service
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
# ou
bash start.sh
```

## Como testar

```bash
cd python_service
pytest tests/ -v
```

## Modelo demonstrativo Scikit-learn (opcional)

```bash
cd python_service
python train_demo_model.py
```

Gera `models/risk_model.joblib` e `results/metrics.json`.
**⚠️ Dataset sintético — não representa desempenho operacional real.**

## Motor atual vs. modelo supervisionado

| Aspecto         | Motor atual (regras)            | Modelo supervisionado (PoV)            |
|----------------|----------------------------------|----------------------------------------|
| Tipo           | Regras transparentes documentadas| RandomForest / GradientBoosting        |
| Dados          | Não requer dados históricos      | Requer dados reais representativos     |
| Interpretação  | 100% explicável                  | Parcialmente explicável (SHAP)         |
| Status         | ✅ Operacional (TRL 4)           | 📋 Previsto para Prova de Valor        |

## Limitações

- Motor atual baseado em regras documentadas, não em modelo treinado com dados reais
- Dataset do modelo demonstrativo é sintético (gerado pela própria função de regras)
- Métricas do `metrics.json` são para demonstração do fluxo, não de desempenho real
- Integração com Express usa fallback TypeScript se o serviço Python estiver indisponível
