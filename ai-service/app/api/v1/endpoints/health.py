from fastapi import APIRouter, Depends, Request

from app.core.config import Settings, get_settings
from app.schemas.common import ApiResponse
from app.schemas.health import HealthData

router = APIRouter(tags=["health"])


@router.get("/health", response_model=ApiResponse[HealthData])
async def health(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ApiResponse[HealthData]:
    """仅表示 FastAPI 进程可响应，不探测尚未接入的模型或向量库。"""
    return ApiResponse.success(
        HealthData(
            status="UP",
            service=settings.app_name,
            environment=settings.app_env,
        ),
        request.state.request_id,
    )

