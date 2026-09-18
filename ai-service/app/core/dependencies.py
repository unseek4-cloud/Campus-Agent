from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings
from app.infrastructure.embeddings.sentence_transformer_embedding import (
    SentenceTransformerEmbeddingService,
)
from app.infrastructure.pdf.pypdf_extractor import PypdfDocumentExtractor
from app.services.chunk_service import BoundaryAwareChunkService
from app.services.document_service import DocumentService
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
        extractor=PypdfDocumentExtractor(),
        cleaner=TextCleaner(),
        chunk_service=BoundaryAwareChunkService(
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        ),
        embedding_service=embedding_service,
        vector_store=vector_store,
        max_file_size_bytes=settings.max_pdf_size_mb * 1024 * 1024,
    )
