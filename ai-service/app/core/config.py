import re
from functools import lru_cache
from typing import Self

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """AI 服务配置；值来自环境变量或本地未提交的 .env 文件。"""

    app_name: str = "campus-ai-service"
    app_env: str = "development"
    host: str = "0.0.0.0"
    port: int = 8000
    api_v1_prefix: str = "/internal/v1"
    max_pdf_size_mb: int = Field(default=20, ge=1, le=200)

    chunk_size: int = Field(default=800, ge=100, le=10000)
    chunk_overlap: int = Field(default=100, ge=0)

    ocr_enabled: bool = True
    ocr_language: str = "ch"
    ocr_dpi: int = Field(default=300, ge=72, le=600)
    ocr_device: str = "cpu"
    ocr_enable_mkldnn: bool = False
    ocr_max_pages_per_document: int = Field(default=50, ge=1, le=1000)

    embedding_model_name: str = "BAAI/bge-small-zh-v1.5"
    embedding_device: str = "cpu"
    embedding_batch_size: int = Field(default=32, ge=1, le=512)

    vector_store_path: str = "var/chroma"
    vector_store_collection: str = "campus_documents"
    vector_store_batch_size: int = Field(default=100, ge=1, le=5000)

    retrieval_default_top_k: int = Field(default=5, ge=1, le=100)
    retrieval_max_top_k: int = Field(default=20, ge=1, le=100)

    rerank_enabled: bool = True
    rerank_model_name: str = "BAAI/bge-reranker-base"
    rerank_device: str = "cpu"
    rerank_batch_size: int = Field(default=8, ge=1, le=512)
    rerank_max_length: int = Field(default=512, ge=64, le=8192)
    rerank_candidate_top_k: int = Field(default=10, ge=1, le=100)
    rerank_temporal_evidence_enabled: bool = True
    rerank_temporal_evidence_weight: float = Field(default=0.35, ge=0, le=1)

    rag_retrieval_top_k: int = Field(default=10, ge=1, le=100)
    rag_context_top_k: int = Field(default=3, ge=1, le=20)
    rag_min_rerank_score: float = 0.015
    rag_min_relative_score: float = Field(default=0.4, ge=0, le=1)
    rag_max_context_chars: int = Field(default=6000, ge=500, le=50000)

    llm_provider: str = "qwen"
    qwen_api_key: str = ""
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model: str = "qwen-plus"
    llm_timeout_seconds: float = Field(default=30.0, gt=0, le=300)
    llm_temperature: float = Field(default=0.2, ge=0, le=2)
    llm_max_tokens: int = Field(default=1000, ge=1, le=8192)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="AI_",
        extra="ignore",
    )

    @model_validator(mode="after")
    def validate_chunk_settings(self) -> Self:
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")
        if self.retrieval_default_top_k > self.retrieval_max_top_k:
            raise ValueError(
                "retrieval_default_top_k must not exceed retrieval_max_top_k"
            )
        if self.rag_retrieval_top_k > self.retrieval_max_top_k:
            raise ValueError("rag_retrieval_top_k must not exceed retrieval_max_top_k")
        if self.rag_context_top_k > self.rag_retrieval_top_k:
            raise ValueError("rag_context_top_k must not exceed rag_retrieval_top_k")
        return self

    @field_validator("ocr_language")
    @classmethod
    def validate_ocr_language(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("ocr_language must not be blank")
        return value

    @field_validator("rerank_model_name")
    @classmethod
    def validate_rerank_model_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("rerank_model_name must not be blank")
        return value

    @field_validator("ocr_device")
    @classmethod
    def validate_ocr_device(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"(?:cpu|gpu(?::\d+)?)", value):
            raise ValueError("ocr_device must be cpu, gpu, or gpu:<index>")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
