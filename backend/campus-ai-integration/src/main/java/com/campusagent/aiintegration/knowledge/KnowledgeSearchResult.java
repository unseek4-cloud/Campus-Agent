package com.campusagent.aiintegration.knowledge;

/** One ranked knowledge chunk with its recall and rerank scores. */
public record KnowledgeSearchResult(
        int rank,
        String content,
        double score,
        Double rerankScore,
        Double evidenceScore,
        String evidenceText,
        Double finalScore,
        String documentId,
        String knowledgeBaseId,
        String fileName,
        String fileType,
        Integer pageNumber,
        int chunkIndex,
        String source
) {
}
