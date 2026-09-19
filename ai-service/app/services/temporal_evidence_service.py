import re
from dataclasses import dataclass


_DATE = re.compile(
    r"(?:(?<!\d)(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}"
    r"|(?:(?:19|20)\d{2}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日)"
)
_TIME_QUERY = re.compile(r"时间|什么时候|何时|哪天|几号|日期")
_DEADLINE_QUERY = re.compile(r"截止|截至|最晚|结束|最后期限")
_DEADLINE_LABEL = re.compile(r"截止|截至|最晚|结束|最后期限")
_SCHEDULE_LABEL = re.compile(r"时间|日期|日程|安排")


@dataclass(frozen=True, slots=True)
class TemporalEvidence:
    score: float
    text: str | None


class TemporalEvidenceService:
    """Find date-bearing source lines and distinguish schedule from deadline."""

    def assess(self, query: str, content: str) -> TemporalEvidence:
        if not _TIME_QUERY.search(query):
            return TemporalEvidence(0.0, None)

        wants_deadline = bool(_DEADLINE_QUERY.search(query))
        lines = [line.strip() for line in content.splitlines() if line.strip()]
        best = TemporalEvidence(0.0, None)

        for index, line in enumerate(lines):
            date = _DATE.search(line)
            if date is None:
                continue

            # The heading often occupies the line immediately before the date.
            previous = lines[index - 1] if index > 0 else ""
            heading = (
                previous
                if len(previous) <= 40 and _SCHEDULE_LABEL.search(previous)
                else ""
            )
            label = f"{heading} {line[:date.start()]}"[-80:]
            is_deadline = bool(_DEADLINE_LABEL.search(label))
            is_schedule = bool(_SCHEDULE_LABEL.search(label))
            if is_deadline == wants_deadline and (is_deadline or is_schedule):
                score = 1.0
            elif is_deadline or is_schedule:
                score = -1.0
            else:
                score = 0.25

            evidence = "\n".join((heading, line)) if heading else line
            if score > best.score or (best.text is None and score < 0):
                best = TemporalEvidence(score, evidence)

        return best
