from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.core.dependencies import get_retrieval_service
from app.schemas.common import ApiResponse
from app.schemas.knowledge import (
    KnowledgeSearchData,
    KnowledgeSearchRequest,
    KnowledgeSearchResultData,
)
from app.services.retrieval_service import RetrievalService

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.post(
    "/search",
    response_model=ApiResponse[KnowledgeSearchData],
)
async def search_knowledge(
    payload: KnowledgeSearchRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    retrieval_service: RetrievalService = Depends(get_retrieval_service),
) -> ApiResponse[KnowledgeSearchData]:
    top_k = payload.top_k or settings.retrieval_default_top_k
    matches = await run_in_threadpool(
        retrieval_service.search,
        payload.query,
        top_k,
        payload.knowledge_base_id,
    )
    results = [
        KnowledgeSearchResultData(
            rank=index,
            content=match.content,
            score=match.score,
            rerankScore=match.rerank_score,
            evidenceScore=match.evidence_score,
            evidenceText=match.evidence_text,
            finalScore=match.final_score,
            documentId=str(match.metadata.get("document_id", "")),
            knowledgeBaseId=str(match.metadata.get("knowledge_base_id", "")),
            fileName=str(match.metadata.get("file_name", "")),
            fileType=str(match.metadata.get("file_type", "")),
            pageNumber=(
                int(match.metadata["page_number"])
                if "page_number" in match.metadata
                else None
            ),
            chunkIndex=int(match.metadata.get("chunk_index", 0)),
            source=str(match.metadata.get("source", "")),
        )
        for index, match in enumerate(matches, start=1)
    ]
    return ApiResponse.success(
        KnowledgeSearchData(query=payload.query, results=results),
        request.state.request_id,
    )
