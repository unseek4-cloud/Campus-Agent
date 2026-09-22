package com.campusagent.affair.serviceguide.service;

import com.campusagent.affair.serviceguide.dto.ServiceRecognitionResponse;

public interface ServiceIntentRecognizer {
    ServiceRecognitionResponse recognize(String query);
}
