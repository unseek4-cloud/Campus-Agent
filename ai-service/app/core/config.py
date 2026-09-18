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
        return self

    @field_validator("ocr_language")
    @classmethod
    def validate_ocr_language(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("ocr_language must not be blank")
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
