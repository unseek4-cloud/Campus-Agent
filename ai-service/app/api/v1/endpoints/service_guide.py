from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from app.core.dependencies import get_service_guide_ai_service
from app.schemas.common import ApiResponse
from app.schemas.rag import RagChatData, RagSourceData
from app.schemas.service_guide import NarrationRequest, RecognitionRequest
from app.services.service_guide_service import ServiceGuideAiService

router = APIRouter(prefix="/service-guide", tags=["service-guide"])


@router.post("/recognize")
async def recognize(payload: RecognitionRequest, request: Request,
                    service: ServiceGuideAiService = Depends(get_service_guide_ai_service)):
    result = await run_in_threadpool(service.recognize, payload)
    return ApiResponse.success(result, request.state.request_id)


@router.post("/narrate", response_model=ApiResponse[RagChatData])
async def narrate(payload: NarrationRequest, request: Request,
                  service: ServiceGuideAiService = Depends(get_service_guide_ai_service)):
    result = await run_in_threadpool(service.narrate, payload)
    sources = [RagSourceData(
        documentId=str(s.match.metadata.get("document_id", "")),
        fileName=str(s.match.metadata.get("file_name", "")),
        chunkIndex=int(s.match.metadata.get("chunk_index", 0)),
        pageNumber=s.match.metadata.get("page_number"),
        score=s.match.score, rerankScore=s.match.rerank_score, content=s.content,
    ) for s in result.sources]
    return ApiResponse.success(RagChatData(answer=result.answer, sources=sources,
        retrievalCount=result.retrieval_count, rerankCount=result.rerank_count,
        usedContextCount=len(sources), rewrittenQuery=result.rewritten_query), request.state.request_id)
