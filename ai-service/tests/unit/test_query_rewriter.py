import pytest

from app.conversation.query_rewriter import QueryRewriter
from app.core.exceptions import LlmTimeoutError
from app.llm.base import LlmProvider
from app.schemas.rag import ConversationMessage


class ScriptedProvider(LlmProvider):
    def __init__(self, response: str | Exception) -> None:
        self.response = response
        self.calls: list[tuple[str, str, float | None]] = []

    def generate(
        self, system_prompt: str, user_prompt: str, *, temperature: float | None = None
    ) -> str:
        self.calls.append((system_prompt, user_prompt, temperature))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def history() -> list[ConversationMessage]:
    return [
        ConversationMessage(role="user", content="2026级新生心理测评什么时候？"),
        ConversationMessage(role="assistant", content="测评时间是2026年9月19日至22日。"),
    ]


@pytest.mark.parametrize(
    ("current", "rewritten"),
    [
        ("对象是谁？", "2026级新生心理测评对象是谁？"),
        ("在哪里进行？", "2026级新生心理测评在哪里进行？"),
        ("学校图书馆开放时间是什么？", "学校图书馆开放时间是什么？"),
        ("奖学金申请需要什么材料？", "奖学金申请需要什么材料？"),
    ],
)
def test_rewrite_includes_topic_only_when_current_question_depends_on_it(
    current: str, rewritten: str
) -> None:
    provider = ScriptedProvider(rewritten)
    assert QueryRewriter(provider, 0).rewrite(current, history()) == rewritten
    system, user, temperature = provider.calls[0]
    assert "历史助手回答可能有误" in system
    assert "2026级新生心理测评" in user
    assert current in user
    assert temperature == 0


def test_empty_history_skips_provider() -> None:
    provider = ScriptedProvider("不应使用")
    assert QueryRewriter(provider, 0).rewrite("独立问题？", []) == "独立问题？"
    assert provider.calls == []


@pytest.mark.parametrize(
    "response",
    [LlmTimeoutError("timed out"), "", "改写后问题：对象是谁？", "问题一\n问题二"],
)
def test_failed_or_malformed_rewrite_falls_back(response: str | Exception) -> None:
    provider = ScriptedProvider(response)
    assert QueryRewriter(provider, 0).rewrite("对象是谁？", history()) == "对象是谁？"
