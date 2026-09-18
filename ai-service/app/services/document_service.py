import hashlib
import re
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
from app.vector_store.base import VectorStore

_ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/x-pdf",
    "application/octet-stream",
}


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
    ) -> None:
        self._extractor = extractor
        self._cleaner = cleaner
        self._chunk_service = chunk_service
        self._embedding_service = embedding_service
        self._vector_store = vector_store
        self._max_file_size_bytes = max_file_size_bytes

    def process_pdf(self, document: DocumentInput) -> DocumentProcessingResult:
        document_id = document.document_id.strip()
        knowledge_base_id = document.knowledge_base_id.strip()
        file_name = self._safe_file_name(document.file_name)
        self._validate_document(document, document_id, knowledge_base_id, file_name)

        pages = self._extractor.extract(document.content)
        cleaned_pages = self._cleaner.clean_pages(pages)
        if not any(page.text for page in cleaned_pages):
            raise EmptyDocumentError(
                "PDF contains no extractable text; scanned PDFs require OCR"
            )

        chunks = self._chunk_service.split(cleaned_pages)
        if not chunks:
            raise EmptyDocumentError("PDF contains no text that can be chunked")

        embeddings = self._embedding_service.embed_documents(
            [chunk.text for chunk in chunks]
        )
        if len(embeddings) != len(chunks):
            raise EmbeddingGenerationError(
                "Embedding provider returned a different number of vectors than chunks"
            )

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
                    "page_number": chunk.page_number,
                    "chunk_index": chunk.chunk_index,
                    "embedding_model": self._embedding_service.model_name,
                    "content_sha256": content_sha256,
                },
            )
            for chunk, embedding in zip(chunks, embeddings, strict=True)
        ]
        self._vector_store.replace_document(document_id, records)

        return DocumentProcessingResult(
            document_id=document_id,
            knowledge_base_id=knowledge_base_id,
            file_name=file_name,
            page_count=len(pages),
            chunk_count=len(chunks),
            embedding_model=self._embedding_service.model_name,
            content_sha256=content_sha256,
        )

    def _validate_document(
        self,
        document: DocumentInput,
        document_id: str,
        knowledge_base_id: str,
        file_name: str,
    ) -> None:
        if not document_id or not knowledge_base_id:
            raise InvalidDocumentError("documentId and knowledgeBaseId must not be blank")
        if not file_name.lower().endswith(".pdf"):
            raise UnsupportedDocumentTypeError("Only PDF files are supported")
        if document.content_type and document.content_type.lower() not in _ALLOWED_CONTENT_TYPES:
            raise UnsupportedDocumentTypeError("Only PDF files are supported")
        if not document.content:
            raise InvalidDocumentError("Uploaded PDF is empty")
        if len(document.content) > self._max_file_size_bytes:
            raise DocumentTooLargeError("Uploaded PDF exceeds the configured size limit")
        if not document.content.startswith(b"%PDF-"):
            raise InvalidDocumentError("Uploaded file does not have a valid PDF header")

    @staticmethod
    def _safe_file_name(file_name: str) -> str:
        return re.split(r"[\\/]", file_name.strip())[-1]
