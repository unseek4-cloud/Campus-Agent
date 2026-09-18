from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RenderedPage:
    page_number: int
    image: bytes


class PdfPageRenderer(ABC):
    """Port for rendering one PDF page without coupling it to an OCR engine."""

    @abstractmethod
    def render_page(
        self, content: bytes, page_number: int, dpi: int
    ) -> RenderedPage:
        """Render a one-based PDF page into an encoded image."""
