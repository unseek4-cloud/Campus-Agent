from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from app.core.time import now_utc_plus_8

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """AI 服务普通 JSON 接口的统一响应结构。"""

    code: str
    message: str
    data: T | None = None
    request_id: str = Field(alias="requestId")
    timestamp: datetime

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def success(cls, data: T, request_id: str) -> "ApiResponse[T]":
        return cls(
            code="OK",
            message="success",
            data=data,
            requestId=request_id,
            timestamp=now_utc_plus_8(),
        )

    @classmethod
    def error(cls, code: str, message: str, request_id: str) -> "ApiResponse[None]":
        return cls(
            code=code,
            message=message,
            data=None,
            requestId=request_id,
            timestamp=now_utc_plus_8(),
        )
