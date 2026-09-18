from contextlib import suppress
from io import BytesIO
from typing import Any

from app.core.exceptions import PdfPageRenderingError
from app.services.pdf_page_renderer import PdfPageRenderer, RenderedPage


class PdfiumPageRenderer(PdfPageRenderer):
    """Renders one PDF page to PNG with pypdfium2."""

    def render_page(
        self, content: bytes, page_number: int, dpi: int
    ) -> RenderedPage:
        if page_number <= 0:
            raise PdfPageRenderingError("PDF page number must be one-based")
        if dpi <= 0:
            raise PdfPageRenderingError("PDF render DPI must be greater than zero")

        document: Any | None = None
        page: Any | None = None
        bitmap: Any | None = None
        image: Any | None = None
        try:
            import pypdfium2 as pdfium

            document = pdfium.PdfDocument(content)
            if page_number > len(document):
                raise PdfPageRenderingError(
                    f"PDF page {page_number} is outside the document"
                )

            page = document[page_number - 1]
            bitmap = page.render(scale=dpi / 72)
            image = bitmap.to_pil()
            output = BytesIO()
            image.save(output, format="PNG")
            return RenderedPage(page_number=page_number, image=output.getvalue())
        except PdfPageRenderingError:
            raise
        except Exception as exception:
            raise PdfPageRenderingError(
                f"Failed to render PDF page {page_number}"
            ) from exception
        finally:
            for resource in (image, bitmap, page, document):
                if resource is not None and hasattr(resource, "close"):
                    with suppress(Exception):
                        resource.close()
