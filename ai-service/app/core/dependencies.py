from functools import lru_cache
from pathlib import Path
from threading import Semaphore
import os

from app.core.config import get_settings
from app.conversation.query_rewriter import QueryRewriter
from app.llm.llm_factory import create_llm_provider
from app.infrastructure.docx.docx_extractor import DocxDocumentExtractor
from app.infrastructure.embeddings.sentence_transformer_embedding import (
    SentenceTransformerEmbeddingService,
)
from app.infrastructure.ocr.paddle_ocr_service import PaddleOcrService
from app.infrastructure.ocr.ocr_manager import OCRManager
from app.infrastructure.ocr.qwen_ocr_provider import QwenOCRProvider
from app.infrastructure.pdf.pdfium_page_renderer import PdfiumPageRenderer
from app.infrastructure.pdf.pypdf_extractor import PypdfDocumentExtractor
from app.infrastructure.rerankers.sentence_transformer_reranker import (
    SentenceTransformerRerankService,
)
from app.services.chunk_service import BoundaryAwareChunkService
from app.services.document_service import DocumentService
from app.services.document_parsers import ParserRegistry, TextParser, MarkdownParser, XlsxParser, PptxParser, ImageParser
from app.services.embedding_service import EmbeddingService
from app.services.evidence_aware_rerank_service import EvidenceAwareRerankService
from app.services.ocr_fallback_document_extractor import OcrFallbackDocumentExtractor
from app.services.rerank_service import RerankService
from app.services.retrieval_service import RetrievalService
from app.services.context_builder import ContextBuilder
from app.services.rag_service import RagService
from app.services.service_guide_service import ServiceGuideAiService
from app.services.result_filter import RerankResultFilter
from app.services.temporal_evidence_service import TemporalEvidenceService
from app.services.text_cleaner import TextCleaner
from app.vector_store.chroma_store import ChromaVectorStore

_AI_SERVICE_ROOT = Path(__file__).resolve().parents[2]


@lru_cache
def get_service_guide_ai_service() -> ServiceGuideAiService:
    settings = get_settings()
    return ServiceGuideAiService(
        llm=create_llm_provider(settings), retrieval=get_retrieval_service,
        result_filter=RerankResultFilter(settings.rag_min_rerank_score, settings.rag_context_top_k,
                                       settings.rag_min_relative_score),
        context_builder=ContextBuilder(settings.rag_max_context_chars), top_k=settings.rag_retrieval_top_k,
    )


@lru_cache
def get_embedding_service() -> EmbeddingService:
    settings = get_settings()
    return SentenceTransformerEmbeddingService(
        model_name=settings.embedding_model_name,
        device=settings.embedding_device,
        batch_size=settings.embedding_batch_size,
    )


@lru_cache
def get_vector_store() -> ChromaVectorStore:
    settings = get_settings()
    vector_store_path = Path(settings.vector_store_path)
    if not vector_store_path.is_absolute():
        vector_store_path = _AI_SERVICE_ROOT / vector_store_path
    return ChromaVectorStore(
        path=vector_store_path,
        collection_name=settings.vector_store_collection,
        batch_size=settings.vector_store_batch_size,
    )


@lru_cache
def get_rerank_service() -> RerankService | None:
    settings = get_settings()
    if not settings.rerank_enabled:
        return None
    base_reranker = SentenceTransformerRerankService(
        model_name=settings.rerank_model_name,
        device=settings.rerank_device,
        batch_size=settings.rerank_batch_size,
        max_length=settings.rerank_max_length,
    )
    if not settings.rerank_temporal_evidence_enabled:
        return base_reranker
    return EvidenceAwareRerankService(
        base_reranker=base_reranker,
        temporal_evidence=TemporalEvidenceService(),
        evidence_weight=settings.rerank_temporal_evidence_weight,
    )


@lru_cache
def get_document_service() -> DocumentService:
    """Composition root: the only place binding ports to concrete adapters."""
    settings = get_settings()
    cleaner = TextCleaner()
    paddle = PaddleOcrService(
            language=settings.ocr_language,
            device=settings.ocr_device,
            enable_mkldnn=settings.ocr_enable_mkldnn,
        )
    ocr = OCRManager(
        qwen=QwenOCRProvider(
            api_key=settings.qwen_ocr_api_key or settings.qwen_api_key or os.getenv("DASHSCOPE_API_KEY", ""),
            base_url=settings.qwen_ocr_base_url or settings.qwen_base_url,
            model=settings.qwen_ocr_model,
            timeout=settings.qwen_ocr_timeout,
            max_retries=settings.qwen_ocr_max_retries,
            trust_env=settings.qwen_trust_env,
        ),
        paddle=paddle, mode=settings.ocr_mode,
        allow_cloud=settings.ocr_allow_cloud, qwen_enabled=settings.qwen_ocr_enabled,
    )
    extractor = OcrFallbackDocumentExtractor(
        text_extractor=PypdfDocumentExtractor(),
        cleaner=cleaner,
        page_renderer=PdfiumPageRenderer(),
        ocr_service=ocr,
        enabled=settings.ocr_enabled,
        dpi=settings.ocr_dpi,
        max_ocr_pages_per_document=settings.ocr_max_pages_per_document,
        max_concurrency=settings.ocr_max_concurrency,
        text_threshold=settings.ocr_text_threshold,
        work_limit=_ocr_work_limit(settings.ocr_max_concurrency),
        strict_ocr=True,
    )
    return DocumentService(
        extractor=extractor,
        docx_extractor=DocxDocumentExtractor(),
        parser_registry=ParserRegistry({
            "pdf": extractor, "docx": DocxDocumentExtractor(),
            "txt": TextParser(), "md": MarkdownParser(), "xlsx": XlsxParser(),
            "pptx": PptxParser(), "png": ImageParser(ocr),
            "jpg": ImageParser(ocr), "jpeg": ImageParser(ocr),
        }),
        cleaner=cleaner,
        chunk_service=BoundaryAwareChunkService(
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        ),
        embedding_service=get_embedding_service(),
        vector_store=get_vector_store(),
        max_file_size_bytes=settings.max_pdf_size_mb * 1024 * 1024,
    )


@lru_cache
def _ocr_work_limit(concurrency: int) -> Semaphore:
    return Semaphore(concurrency)


@lru_cache
def get_retrieval_service() -> RetrievalService:
    settings = get_settings()
    return RetrievalService(
        embedding_service=get_embedding_service(),
        vector_store=get_vector_store(),
        max_top_k=settings.retrieval_max_top_k,
        rerank_service=get_rerank_service(),
        candidate_top_k=settings.rerank_candidate_top_k,
    )


@lru_cache
def get_rag_service() -> RagService:
    settings = get_settings()
    llm = create_llm_provider(settings)
    return RagService(
        retrieval=get_retrieval_service(),
        result_filter=RerankResultFilter(
            min_rerank_score=settings.rag_min_rerank_score,
            top_k=settings.rag_context_top_k,
            min_relative_score=settings.rag_min_relative_score,
        ),
        context_builder=ContextBuilder(settings.rag_max_context_chars),
        llm=llm,
        retrieval_top_k=settings.rag_retrieval_top_k,
        query_rewriter=QueryRewriter(llm, settings.query_rewrite_temperature),
        conversation_max_messages=settings.conversation_max_messages,
        query_rewrite_enabled=settings.query_rewrite_enabled,
    )
