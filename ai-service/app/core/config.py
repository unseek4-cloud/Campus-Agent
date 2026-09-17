from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """AI 服务配置；值来自环境变量或本地未提交的 .env 文件。"""

    app_name: str = "campus-ai-service"
    app_env: str = "development"
    host: str = "0.0.0.0"
    port: int = 8000
    api_v1_prefix: str = "/internal/v1"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="AI_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()

