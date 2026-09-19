from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("content must not be blank")
        return value


class RagChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    knowledge_base_id: str | None = Field(default=None, alias="knowledgeBaseId", max_length=128)
    history: list[ConversationMessage] = Field(default_factory=list, max_length=100)

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("query")
    @classmethod
    def query_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("query must not be blank")
        return value


class RagSourceData(BaseModel):
    document_id: str = Field(alias="documentId")
    file_name: str = Field(alias="fileName")
    chunk_index: int = Field(alias="chunkIndex")
    page_number: int | None = Field(alias="pageNumber")
    score: float
    rerank_score: float = Field(alias="rerankScore")
    content: str

    model_config = ConfigDict(populate_by_name=True)


class RagChatData(BaseModel):
    answer: str
    sources: list[RagSourceData]
    retrieval_count: int = Field(alias="retrievalCount")
    rerank_count: int = Field(alias="rerankCount")
    used_context_count: int = Field(alias="usedContextCount")
    rewritten_query: str = Field(alias="rewrittenQuery")

    model_config = ConfigDict(populate_by_name=True)
