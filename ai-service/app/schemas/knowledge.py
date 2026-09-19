from pydantic import BaseModel, ConfigDict, Field, field_validator


class KnowledgeSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    top_k: int | None = Field(default=None, alias="topK", ge=1, le=100)
    knowledge_base_id: str | None = Field(
        default=None, alias="knowledgeBaseId", max_length=128
    )

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("query")
    @classmethod
    def query_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("query must not be blank")
        return value


class KnowledgeSearchResultData(BaseModel):
    rank: int
    content: str
    score: float
    rerank_score: float | None = Field(default=None, alias="rerankScore")
    evidence_score: float | None = Field(default=None, alias="evidenceScore")
    evidence_text: str | None = Field(default=None, alias="evidenceText")
    final_score: float | None = Field(default=None, alias="finalScore")
    document_id: str = Field(alias="documentId")
    knowledge_base_id: str = Field(alias="knowledgeBaseId")
    file_name: str = Field(alias="fileName")
    file_type: str = Field(alias="fileType")
    page_number: int | None = Field(default=None, alias="pageNumber")
    chunk_index: int = Field(alias="chunkIndex")
    source: str

    model_config = ConfigDict(populate_by_name=True)


class KnowledgeSearchData(BaseModel):
    query: str
    results: list[KnowledgeSearchResultData]
