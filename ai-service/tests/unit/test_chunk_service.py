import pytest

from app.domain.document import DocumentPage
from app.services.chunk_service import BoundaryAwareChunkService


def test_chunker_preserves_page_number_order_and_size() -> None:
    chunker = BoundaryAwareChunkService(chunk_size=12, chunk_overlap=3)
    pages = [
        DocumentPage(page_number=1, text="第一句话。第二句话。第三句话。"),
        DocumentPage(page_number=2, text="第二页。"),
    ]

    chunks = chunker.split(pages)

    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert chunks[-1].page_number == 2
    assert all(0 < len(chunk.text) <= 12 for chunk in chunks)


def test_chunker_uses_exact_overlap_when_no_boundary_exists() -> None:
    chunker = BoundaryAwareChunkService(chunk_size=10, chunk_overlap=3)

    chunks = chunker.split([DocumentPage(page_number=1, text="abcdefghijklmnop")])

    assert [chunk.text for chunk in chunks] == ["abcdefghij", "hijklmnop"]


def test_chunker_starts_overlap_at_sentence_boundary_when_available() -> None:
    chunker = BoundaryAwareChunkService(chunk_size=8, chunk_overlap=3)

    chunks = chunker.split(
        [DocumentPage(page_number=1, text="第一句。第二句。第三句。")]
    )

    assert [chunk.text for chunk in chunks] == [
        "第一句。第二句。",
        "第二句。第三句。",
    ]


@pytest.mark.parametrize(
    ("chunk_size", "chunk_overlap"),
    [(0, 0), (10, -1), (10, 10), (10, 11)],
)
def test_chunker_rejects_invalid_configuration(
    chunk_size: int, chunk_overlap: int
) -> None:
    with pytest.raises(ValueError):
        BoundaryAwareChunkService(chunk_size, chunk_overlap)
