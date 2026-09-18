import re
import unicodedata
from collections.abc import Sequence

from app.domain.document import DocumentPage

_HORIZONTAL_WHITESPACE = re.compile(r"[^\S\n]+")
_EXCESSIVE_NEWLINES = re.compile(r"\n{3,}")


class TextCleaner:
    """Conservative text cleanup that does not guess document semantics."""

    def clean_pages(self, pages: Sequence[DocumentPage]) -> list[DocumentPage]:
        return [
            DocumentPage(page_number=page.page_number, text=self.clean(page.text))
            for page in pages
        ]

    def clean(self, text: str) -> str:
        text = unicodedata.normalize("NFKC", text)
        text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
        text = "".join(character for character in text if self._keep_character(character))

        lines = []
        for line in text.split("\n"):
            normalized_line = _HORIZONTAL_WHITESPACE.sub(" ", line).strip()
            lines.append(normalized_line)

        text = "\n".join(lines)
        text = _EXCESSIVE_NEWLINES.sub("\n\n", text)
        return text.strip()

    @staticmethod
    def _keep_character(character: str) -> bool:
        if character in {"\n", "\t"}:
            return True
        return not unicodedata.category(character).startswith("C")
