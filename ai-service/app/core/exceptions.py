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


class EmptyDocumentError(DocumentProcessingError):
    pass


class EmbeddingGenerationError(DocumentProcessingError):
    pass


class VectorStoreOperationError(DocumentProcessingError):
    pass
