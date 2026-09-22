package com.campusagent.affair.serviceguide.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ServiceRecognitionResponse(boolean matched, String serviceCode, String serviceName, Double confidence) {
    public static ServiceRecognitionResponse unmatched() { return new ServiceRecognitionResponse(false, null, null, null); }
    public static ServiceRecognitionResponse match(ServiceItemDTO item, double confidence) {
        return new ServiceRecognitionResponse(true, item.code(), item.name(), confidence);
    }
}
