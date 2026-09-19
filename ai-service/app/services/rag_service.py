import logging
from collections.abc import Sequence

from app.conversation.query_rewriter import QueryRewriter
from app.llm.base import LlmProvider
from app.llm.prompts import SYSTEM_PROMPT, build_user_prompt
from app.schemas.rag import ConversationMessage
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
        rewritten_query: str = "",
    ) -> None:
        self.answer = answer
        self.sources = sources
        self.retrieval_count = retrieval_count
        self.rerank_count = rerank_count
        self.rewritten_query = rewritten_query


class RagService:
    def __init__(
        self,
        retrieval: RetrievalService,
        result_filter: RerankResultFilter,
        context_builder: ContextBuilder,
        llm: LlmProvider,
        retrieval_top_k: int,
        query_rewriter: QueryRewriter | None = None,
        conversation_max_messages: int = 8,
        query_rewrite_enabled: bool = True,
    ) -> None:
        if conversation_max_messages <= 0:
            raise ValueError("conversation_max_messages must be greater than zero")
        self._retrieval = retrieval
        self._filter = result_filter
        self._context_builder = context_builder
        self._llm = llm
        self._retrieval_top_k = retrieval_top_k
        self._query_rewriter = query_rewriter
        self._conversation_max_messages = conversation_max_messages
        self._query_rewrite_enabled = query_rewrite_enabled

    def answer(
        self,
        query: str,
        knowledge_base_id: str | None = None,
        history: Sequence[ConversationMessage] | None = None,
    ) -> RagResult:
        logger.info("RAG query received")
        query = query.strip()
        if not query:
            raise ValueError("query must not be blank")
        recent_history = list(history or [])[-self._conversation_max_messages:]
        logger.info("conversation history count = %d", len(recent_history))
        standalone_query = query
        if recent_history and self._query_rewrite_enabled and self._query_rewriter is not None:
            standalone_query = self._query_rewriter.rewrite(query, recent_history)
        logger.info("original query = %s", query)
        logger.info("rewritten query = %s", standalone_query)
        run = self._retrieval.search_with_counts(
            standalone_query, self._retrieval_top_k, knowledge_base_id
        )
        logger.info("retrieval count = %d, rerank count = %d", run.retrieval_count, run.rerank_count)
        selected = self._filter.select(run.results)
        context = self._context_builder.build(selected)
        logger.info("context count = %d", len(context.sources))
        if not context.sources:
            return RagResult(
                NO_INFORMATION, [], run.retrieval_count, run.rerank_count, standalone_query
            )
        logger.info("calling LLM provider")
        answer = self._llm.generate(SYSTEM_PROMPT, build_user_prompt(query, context.text))
        logger.info("LLM response success")
        return RagResult(
            answer, context.sources, run.retrieval_count, run.rerank_count, standalone_query
        )
