import logging
from collections.abc import Sequence

from app.llm.base import LlmProvider
from app.llm.prompts import QUERY_REWRITE_SYSTEM_PROMPT, build_query_rewrite_prompt
from app.schemas.rag import ConversationMessage

logger = logging.getLogger(__name__)


class QueryRewriter:
    """Resolve references for retrieval without supplying conversation as evidence."""

    def __init__(self, llm: LlmProvider, temperature: float) -> None:
        self._llm = llm
        self._temperature = temperature

    def rewrite(self, query: str, history: Sequence[ConversationMessage]) -> str:
        if not history:
            return query

        logger.info("query rewrite start")
        try:
            rewritten = self._llm.generate(
                QUERY_REWRITE_SYSTEM_PROMPT,
                build_query_rewrite_prompt(query, history),
                temperature=self._temperature,
            ).strip()
            if (
                not rewritten
                or len(rewritten) > 4000
                or "\n" in rewritten
                or rewritten.startswith(("改写后问题", "改写结果", "```"))
            ):
                raise ValueError("invalid rewrite output")
        except Exception as exception:
            logger.warning(
                "query rewrite failed, fallback to original query: %s",
                type(exception).__name__,
            )
            return query

        logger.info("query rewrite success")
        return rewritten
