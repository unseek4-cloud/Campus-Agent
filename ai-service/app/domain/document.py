from dataclasses import dataclass

MetadataValue = str | int | float | bool


@dataclass(frozen=True, slots=True)
class DocumentInput:
    document_id: str
    knowledge_base_id: str
    file_name: str
    content_type: str | None
    content: bytes


@dataclass(frozen=True, slots=True)
class DocumentPage:
    page_number: int | None
    text: str


@dataclass(frozen=True, slots=True)
class TextChunk:
    chunk_index: int
    page_number: int | None
    text: str


@dataclass(frozen=True, slots=True)
class VectorRecord:
    record_id: str
    document: str
    embedding: list[float]
    metadata: dict[str, MetadataValue]


@dataclass(frozen=True, slots=True)
class DocumentProcessingResult:
    document_id: str
    knowledge_base_id: str
    file_name: str
    page_count: int
    chunk_count: int
    embedding_model: str
    content_sha256: str
    ocr_provider: str = "none"


@dataclass(frozen=True, slots=True)
class VectorSearchResult:
    content: str
    score: float
    metadata: dict[str, MetadataValue]
    rerank_score: float | None = None
    evidence_score: float | None = None
    evidence_text: str | None = None
    final_score: float | None = None
