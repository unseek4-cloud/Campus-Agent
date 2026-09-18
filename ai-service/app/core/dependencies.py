from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings
from app.infrastructure.embeddings.sentence_transformer_embedding import (
    SentenceTransformerEmbeddingService,
)
from app.infrastructure.ocr.paddle_ocr_service import PaddleOcrService
from app.infrastructure.pdf.pdfium_page_renderer import PdfiumPageRenderer
from app.infrastructure.pdf.pypdf_extractor import PypdfDocumentExtractor
from app.services.chunk_service import BoundaryAwareChunkService
from app.services.document_service import DocumentService
from app.services.ocr_fallback_document_extractor import OcrFallbackDocumentExtractor
from app.services.text_cleaner import TextCleaner
from app.vector_store.chroma_store import ChromaVectorStore

_AI_SERVICE_ROOT = Path(__file__).resolve().parents[2]


@lru_cache
def get_document_service() -> DocumentService:
    """Composition root: the only place binding ports to concrete adapters."""
    settings = get_settings()
    vector_store_path = Path(settings.vector_store_path)
    if not vector_store_path.is_absolute():
        vector_store_path = _AI_SERVICE_ROOT / vector_store_path

    cleaner = TextCleaner()
    extractor = OcrFallbackDocumentExtractor(
        text_extractor=PypdfDocumentExtractor(),
        cleaner=cleaner,
        page_renderer=PdfiumPageRenderer(),
        ocr_service=PaddleOcrService(
            language=settings.ocr_language,
            device=settings.ocr_device,
            enable_mkldnn=settings.ocr_enable_mkldnn,
        ),
        enabled=settings.ocr_enabled,
        dpi=settings.ocr_dpi,
        max_ocr_pages_per_document=settings.ocr_max_pages_per_document,
    )
    embedding_service = SentenceTransformerEmbeddingService(
        model_name=settings.embedding_model_name,
        device=settings.embedding_device,
        batch_size=settings.embedding_batch_size,
    )
    vector_store = ChromaVectorStore(
        path=vector_store_path,
        collection_name=settings.vector_store_collection,
        batch_size=settings.vector_store_batch_size,
    )
    return DocumentService(
        extractor=extractor,
        cleaner=cleaner,
        chunk_service=BoundaryAwareChunkService(
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        ),
        embedding_service=embedding_service,
        vector_store=vector_store,
        max_file_size_bytes=settings.max_pdf_size_mb * 1024 * 1024,
    )
