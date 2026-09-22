from enum import Enum

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.rag import RagChatRequest


class Candidate(BaseModel):
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=10000)


class RecognitionRequest(RagChatRequest):
    candidates: list[Candidate] = Field(max_length=500)


class QueryIntent(str, Enum):
    GENERAL_QA = "GENERAL_QA"
    POLICY_QA = "POLICY_QA"
    ELIGIBILITY_QA = "ELIGIBILITY_QA"
    SERVICE_GUIDE = "SERVICE_GUIDE"


class RecognitionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    matched: bool = Field(default=False, strict=True)
    service_code: str | None = Field(default=None, alias="serviceCode")
    service_name: str | None = Field(default=None, alias="serviceName")
    confidence: float | None = Field(default=None, ge=0.85, le=1, strict=True)
    # Older/missing model fields must never imply a workflow.
    query_intent: QueryIntent = Field(default=QueryIntent.GENERAL_QA, alias="queryIntent")


class Material(BaseModel):
    name: str = Field(max_length=160)
    description: str | None = None
    required: bool = True


class GuideItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    code: str
    name: str
    description: str | None = None
    department: str | None = None
    location: str | None = None
    office_hours: str | None = Field(default=None, alias="officeHours")
    contact: str | None = None
    requirements: list[str] = Field(default_factory=list, max_length=50)
    materials: list[Material] = Field(default_factory=list, max_length=50)
    deadline: str | None = None
    source_document_id: str | None = Field(default=None, alias="sourceDocumentId")
    is_example: bool = Field(default=False, alias="isExample")


class GuideStep(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    order: int = Field(ge=1)
    title: str
    description: str | None = None
    responsible_department: str | None = Field(default=None, alias="responsibleDepartment")
    required_materials: list[str] = Field(default_factory=list, alias="requiredMaterials", max_length=50)
    location: str | None = None
    estimated_time: str | None = Field(default=None, alias="estimatedTime")


class Guide(BaseModel):
    service: GuideItem
    steps: list[GuideStep] = Field(max_length=50)


class NarrationRequest(RagChatRequest):
    guide: Guide
