import logging

from app.llm.base import LlmProvider
from app.llm.prompts import SYSTEM_PROMPT, build_user_prompt
from app.services.context_builder import ContextBuilder, ContextSource
from app.services.result_filter import RerankResultFilter
from app.services.retrieval_service import RetrievalService

logger = logging.getLogger(__name__)
NO_INFORMATION = "根据当前知识库暂未找到相关信息。"


class RagResult:
    def __init__(
        self,
        answer: str,
        sources: list[ContextSource],
        retrieval_count: int,
        rerank_count: int,
    ) -> None:
        self.answer = answer
        self.sources = sources
        self.retrieval_count = retrieval_count
        self.rerank_count = rerank_count


class RagService:
    def __init__(
        self,
        retrieval: RetrievalService,
        result_filter: RerankResultFilter,
        context_builder: ContextBuilder,
        llm: LlmProvider,
        retrieval_top_k: int,
    ) -> None:
        self._retrieval = retrieval
        self._filter = result_filter
        self._context_builder = context_builder
        self._llm = llm
        self._retrieval_top_k = retrieval_top_k

    def answer(self, query: str, knowledge_base_id: str | None = None) -> RagResult:
        logger.info("RAG query received")
        run = self._retrieval.search_with_counts(query, self._retrieval_top_k, knowledge_base_id)
        logger.info("retrieval count = %d, rerank count = %d", run.retrieval_count, run.rerank_count)
        selected = self._filter.select(run.results)
        context = self._context_builder.build(selected)
        logger.info("context count = %d", len(context.sources))
        if not context.sources:
            return RagResult(NO_INFORMATION, [], run.retrieval_count, run.rerank_count)
        logger.info("calling LLM provider")
        answer = self._llm.generate(SYSTEM_PROMPT, build_user_prompt(query, context.text))
        logger.info("LLM response success")
        return RagResult(answer, context.sources, run.retrieval_count, run.rerank_count)
