package com.campusagent.affair.serviceguide.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ServiceRecognitionResponse(boolean matched, String serviceCode, String serviceName, Double confidence,
        QueryIntent queryIntent) {
    public ServiceRecognitionResponse {
        if (queryIntent == null) queryIntent = QueryIntent.GENERAL_QA;
    }
    public static ServiceRecognitionResponse unmatched() { return unmatched(QueryIntent.GENERAL_QA); }
    public static ServiceRecognitionResponse unmatched(QueryIntent intent) {
        return new ServiceRecognitionResponse(false, null, null, null, intent);
    }
    public static ServiceRecognitionResponse match(ServiceItemDTO item, double confidence, QueryIntent intent) {
        return new ServiceRecognitionResponse(true, item.code(), item.name(), confidence, intent);
    }
}
