from pydantic import BaseModel, ConfigDict, Field


class DocumentProcessData(BaseModel):
    document_id: str = Field(alias="documentId")
    knowledge_base_id: str = Field(alias="knowledgeBaseId")
    file_name: str = Field(alias="fileName")
    page_count: int = Field(alias="pageCount")
    chunk_count: int = Field(alias="chunkCount")
    embedding_model: str = Field(alias="embeddingModel")
    content_sha256: str = Field(alias="contentSha256")
    ocr_provider: str = Field(default="none", alias="ocrProvider")

    model_config = ConfigDict(populate_by_name=True)


class DocumentDeleteData(BaseModel):
    document_id: str = Field(alias="documentId")
    deleted_vector_count: int = Field(alias="deletedVectorCount")

    model_config = ConfigDict(populate_by_name=True)
