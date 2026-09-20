import hashlib
import logging
import re
from collections.abc import Callable
from time import monotonic
from uuid import NAMESPACE_URL, uuid5

from app.core.exceptions import (
    EmbeddingGenerationError,
    EmptyDocumentError,
    InvalidDocumentError,
    DocumentTooLargeError,
    UnsupportedDocumentTypeError,
)
from app.domain.document import (
    DocumentInput,
    DocumentProcessingResult,
    VectorRecord,
)
from app.services.chunk_service import ChunkService
from app.services.document_extractor import DocumentExtractor
from app.services.embedding_service import EmbeddingService
from app.services.text_cleaner import TextCleaner
from app.services.document_parsers import ParserRegistry, TextParser, MarkdownParser, XlsxParser, PptxParser
from app.vector_store.base import VectorStore

logger = logging.getLogger(__name__)


class DocumentService:
    """Coordinates ingestion without knowing concrete libraries or providers."""

    def __init__(
        self,
        extractor: DocumentExtractor,
        cleaner: TextCleaner,
        chunk_service: ChunkService,
        embedding_service: EmbeddingService,
        vector_store: VectorStore,
        max_file_size_bytes: int,
        docx_extractor: DocumentExtractor | None = None,
        parser_registry: ParserRegistry | None = None,
    ) -> None:
        self._cleaner = cleaner
        self._chunk_service = chunk_service
        self._embedding_service = embedding_service
        self._vector_store = vector_store
        self._max_file_size_bytes = max_file_size_bytes
        self._parsers = parser_registry or ParserRegistry({
            "pdf": extractor,
            **({"docx": docx_extractor} if docx_extractor else {}),
            "txt": TextParser(), "md": MarkdownParser(),
            "xlsx": XlsxParser(), "pptx": PptxParser(),
        })

    def process_document(self, document: DocumentInput,
                         progress: Callable[[str, int, int, str], None] | None = None) -> DocumentProcessingResult:
        started = monotonic()
        document_id = document.document_id.strip()
        knowledge_base_id = document.knowledge_base_id.strip()
        file_name = self._safe_file_name(document.file_name)
        file_type = self._file_type(file_name)
        self._validate_document(
            document, document_id, knowledge_base_id, file_name, file_type
        )

        extractor = self._parsers.select(file_type, document.content_type, document.content)
        logger.info("parser selected document_id=%s format=%s", document_id, file_type)
        logger.info("document parsing started document_id=%s", document_id)
        ocr_provider = "none"
        def report(stage: str, current: int = 0, total: int = 0, provider: str = "none") -> None:
            nonlocal ocr_provider
            if provider != "none":
                ocr_provider = provider
            if progress:
                progress(stage, current, total, provider)

        report("PARSING")
        parse_started = monotonic()
        extract_with_progress = getattr(extractor, "extract_with_progress", None)
        pages = extract_with_progress(document.content, report) if callable(extract_with_progress) else extractor.extract(document.content)
        logger.info("document parsing completed document_id=%s pages=%d", document_id, len(pages))
        logger.info("[INGEST] document=%s extract_seconds=%.2f", document_id, monotonic()-parse_started)
        cleaned_pages = self._cleaner.clean_pages(pages)
        if not any(page.text for page in cleaned_pages):
            raise EmptyDocumentError("Document contains no usable text after extraction")

        report("CHUNKING", len(pages), len(pages), ocr_provider)
        chunk_started = monotonic()
        chunks = self._chunk_service.split(cleaned_pages)
        if not chunks:
            raise EmptyDocumentError("Document contains no text that can be chunked")
        logger.info("chunk count document_id=%s count=%d; embedding started", document_id, len(chunks))
        logger.info("[INGEST] document=%s chunk_seconds=%.2f", document_id, monotonic()-chunk_started)

        report("EMBEDDING", len(pages), len(pages), ocr_provider)
        embedding_started = monotonic()
        embeddings = self._embedding_service.embed_documents(
            [chunk.text for chunk in chunks]
        )
        if len(embeddings) != len(chunks):
            raise EmbeddingGenerationError(
                "Embedding provider returned a different number of vectors than chunks"
            )
        logger.info("[INGEST] document=%s embedding_seconds=%.2f", document_id, monotonic()-embedding_started)

        content_sha256 = hashlib.sha256(document.content).hexdigest()
        records = [
            VectorRecord(
                record_id=str(
                    uuid5(
                        NAMESPACE_URL,
                        f"campus-agent:{knowledge_base_id}:{document_id}:{chunk.chunk_index}",
                    )
                ),
                document=chunk.text,
                embedding=embedding,
                metadata={
                    "document_id": document_id,
                    "knowledge_base_id": knowledge_base_id,
                    "file_name": file_name,
                    "file_type": file_type,
                    "chunk_index": chunk.chunk_index,
                    "source": file_name,
                    "embedding_model": self._embedding_service.model_name,
                    "content_sha256": content_sha256,
                    **(
                        {"page_number": chunk.page_number}
                        if chunk.page_number is not None
                        else {}
                    ),
                },
            )
            for chunk, embedding in zip(chunks, embeddings, strict=True)
        ]
        report("INDEXING", len(pages), len(pages), ocr_provider)
        self._vector_store.replace_document(document_id, records)
        logger.info("vector save completed document_id=%s count=%d", document_id, len(records))
        report("COMPLETED", len(pages), len(pages), ocr_provider)
        logger.info("[INGEST] document=%s total_seconds=%.2f pages=%d chunks=%d ocr_provider=%s",
                    document_id, monotonic()-started, len(pages), len(chunks), ocr_provider)

        return DocumentProcessingResult(
            document_id=document_id,
            knowledge_base_id=knowledge_base_id,
            file_name=file_name,
            page_count=len(pages),
            chunk_count=len(chunks),
            embedding_model=self._embedding_service.model_name,
            content_sha256=content_sha256,
            ocr_provider=ocr_provider,
        )

    def process_pdf(self, document: DocumentInput) -> DocumentProcessingResult:
        """Backward-compatible alias retained for existing callers and tests."""
        return self.process_document(document)

    def delete_document_vectors(self, document_id: str) -> int:
        normalized_document_id = document_id.strip()
        if not normalized_document_id:
            raise InvalidDocumentError("documentId must not be blank")
        return self._vector_store.delete_document(normalized_document_id)

    def rename_document_vectors(self, document_id: str, file_name: str) -> int:
        if not document_id.strip() or not file_name.strip():
            raise InvalidDocumentError("documentId and fileName must not be blank")
        return self._vector_store.rename_document(document_id.strip(), self._safe_file_name(file_name))

    def _validate_document(
        self,
        document: DocumentInput,
        document_id: str,
        knowledge_base_id: str,
        file_name: str,
        file_type: str,
    ) -> None:
        if not document_id or not knowledge_base_id:
            raise InvalidDocumentError("documentId and knowledgeBaseId must not be blank")
        if file_type not in ParserRegistry.MIME:
            raise UnsupportedDocumentTypeError("暂不支持该文件格式")
        if not document.content:
            raise InvalidDocumentError("Uploaded document is empty")
        if len(document.content) > self._max_file_size_bytes:
            raise DocumentTooLargeError("Uploaded document exceeds the configured size limit")
        self._parsers.select(file_type, document.content_type, document.content)

    @staticmethod
    def _safe_file_name(file_name: str) -> str:
        return re.split(r"[\\/]", file_name.strip())[-1]

    @staticmethod
    def _file_type(file_name: str) -> str:
        extension = file_name.rsplit(".", maxsplit=1)[-1].lower()
        if "." not in file_name or extension not in ParserRegistry.MIME:
            raise UnsupportedDocumentTypeError("暂不支持该文件格式")
        return extension
