from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from app.core.dependencies import get_rag_service
from app.schemas.common import ApiResponse
from app.schemas.rag import RagChatData, RagChatRequest, RagSourceData
from app.services.rag_service import RagService

router = APIRouter(prefix="/rag", tags=["rag"])


@router.post("/chat", response_model=ApiResponse[RagChatData])
async def chat(
    payload: RagChatRequest,
    request: Request,
    rag_service: RagService = Depends(get_rag_service),
) -> ApiResponse[RagChatData]:
    result = await run_in_threadpool(
        rag_service.answer, payload.query, payload.knowledge_base_id
    )
    sources = [
        RagSourceData(
            documentId=str(source.match.metadata.get("document_id", "")),
            fileName=str(source.match.metadata.get("file_name", "")),
            chunkIndex=int(source.match.metadata.get("chunk_index", 0)),
            pageNumber=(
                int(source.match.metadata["page_number"])
                if "page_number" in source.match.metadata
                else None
            ),
            score=source.match.score,
            rerankScore=source.match.rerank_score,
            content=source.content,
        )
        for source in result.sources
    ]
    return ApiResponse.success(
        RagChatData(
            answer=result.answer,
            sources=sources,
            retrievalCount=result.retrieval_count,
            rerankCount=result.rerank_count,
            usedContextCount=len(sources),
        ),
        request.state.request_id,
    )
