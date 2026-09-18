from abc import ABC, abstractmethod


class OcrService(ABC):
    """Provider-neutral port for recognizing text from an encoded page image."""

    @abstractmethod
    def recognize(self, image: bytes) -> str:
        """Recognize text from an encoded image and return it in reading order."""
