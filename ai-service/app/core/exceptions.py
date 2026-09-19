class DocumentProcessingError(Exception):
    """Base class for expected ingestion failures."""


class InvalidDocumentError(DocumentProcessingError):
    pass


class DocumentTooLargeError(InvalidDocumentError):
    pass


class UnsupportedDocumentTypeError(DocumentProcessingError):
    pass


class DocumentExtractionError(DocumentProcessingError):
    pass


class PdfPageRenderingError(DocumentProcessingError):
    pass


class OcrError(DocumentProcessingError):
    pass


class OcrUnavailableError(OcrError):
    pass


class OcrPageLimitExceededError(DocumentProcessingError):
    pass


class EmptyDocumentError(DocumentProcessingError):
    pass


class EmbeddingGenerationError(DocumentProcessingError):
    pass


class VectorStoreOperationError(DocumentProcessingError):
    pass


class RerankError(Exception):
    """The configured reranker could not score retrieval candidates."""


class InvalidRetrievalRequestError(Exception):
    """The retrieval request is syntactically valid but violates service limits."""


class LlmConfigurationError(Exception):
    """LLM provider configuration is missing or unsupported."""


class LlmTimeoutError(Exception):
    """The LLM provider did not respond before the configured timeout."""


class LlmProviderError(Exception):
    """The LLM provider returned an error or invalid response."""
