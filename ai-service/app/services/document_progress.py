"""Short-lived, per-document progress visible while a process request is active."""

from dataclasses import dataclass, asdict
from threading import Lock
from time import monotonic


@dataclass
class Progress:
    status: str = "UPLOADED"
    currentPage: int = 0
    totalPages: int = 0
    progress: int = 0
    ocrProvider: str = "none"
    updated: float = 0


class ProgressStore:
    WEIGHTS = {"UPLOADED": 5, "PARSING": 12, "OCR_PROCESSING": 15,
               "CHUNKING": 75, "EMBEDDING": 82, "INDEXING": 95,
               "COMPLETED": 100, "FAILED": 0}

    def __init__(self) -> None:
        self._items: dict[str, Progress] = {}
        self._lock = Lock()

    def start(self, document_id: str) -> None:
        with self._lock:
            self._items[document_id] = Progress(progress=5, updated=monotonic())

    def update(self, document_id: str, status: str, current: int = 0,
               total: int = 0, provider: str = "none") -> None:
        with self._lock:
            self._purge()
            item = self._items.setdefault(document_id, Progress())
            base = self.WEIGHTS.get(status, 0)
            percent = base + (int(55 * current / total) if status == "OCR_PROCESSING" and total else 0)
            item.progress = 100 if status == "COMPLETED" else max(item.progress, min(99, percent))
            item.status = status
            item.currentPage = current
            item.totalPages = total
            if provider != "none":
                item.ocrProvider = provider
            item.updated = monotonic()

    def get(self, document_id: str) -> dict | None:
        with self._lock:
            item = self._items.get(document_id)
            if item is None:
                return None
            data = asdict(item)
            data.pop("updated")
            return data

    def _purge(self) -> None:
        cutoff = monotonic() - 3600
        for key in [key for key, item in self._items.items() if item.updated < cutoff]:
            del self._items[key]


progress_store = ProgressStore()
