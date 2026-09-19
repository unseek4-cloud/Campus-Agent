package com.campusagent.aiintegration.rag;

/** A chunk that was actually included in the LLM context. */
public record RagSource(
        String documentId,
        String fileName,
        int chunkIndex,
        Integer pageNumber,
        double score,
        double rerankScore,
        String content
) {
}
