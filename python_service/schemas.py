"""
Pydantic schemas for the risk analysis service.
"""
from pydantic import BaseModel, Field, field_validator
from typing import Literal, Optional


VegetationCondition = Literal["very_dry", "dry", "moderate", "humid"]
DataQuality = Literal["poor", "regular", "good", "excellent"]
RiskLevel = Literal["baixo", "moderado", "alto", "critico"]


class RiskInput(BaseModel):
    temperature: float = Field(..., description="Temperatura em °C")
    humidity: float = Field(..., ge=0, le=100, description="Umidade relativa em %")
    wind_speed: float = Field(..., ge=0, description="Velocidade do vento em km/h")
    recent_rainfall: float = Field(default=0, ge=0, description="Precipitação nas últimas 72h em mm")
    vegetation_condition: VegetationCondition = Field(default="moderate")
    nearby_hotspot: bool = Field(default=False)
    hotspot_distance: Optional[float] = Field(default=None, ge=0, description="Distância do foco mais próximo em km")
    historical_occurrences: int = Field(default=0, ge=0)
    data_quality: DataQuality = Field(default="good")

    @field_validator("temperature")
    @classmethod
    def temperature_must_be_present(cls, v):
        if v is None:
            raise ValueError("Temperatura é obrigatória")
        return v


class RiskFactor(BaseModel):
    name: str
    contribution: int
    description: str
    weight: str  # "alto", "médio", "baixo"
    value: str


class RiskRecommendation(BaseModel):
    priority: str  # "imediata", "urgente", "preventiva", "monitoramento"
    action: str
    rationale: str


class RiskOutput(BaseModel):
    score: int = Field(..., ge=0, le=100)
    level: RiskLevel
    confidence: float = Field(..., ge=0, le=1)
    factors: list[RiskFactor]
    recommendations: list[RiskRecommendation]
    model_type: str
    model_version: str
    dataset_type: str  # "synthetic", "real", "rule-based"
    is_simulated: bool
    is_experimental: bool = False
    engine_mode: str = "rules"
    calculated_at: str


class HealthResponse(BaseModel):
    status: str
    service: str
