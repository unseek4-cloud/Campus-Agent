package com.campusagent.affair.serviceguide.service;

import com.campusagent.affair.serviceguide.dto.*;
import java.util.List;

/** AI adapter receives only the active catalog, never direct database access. */
public interface SemanticIntentMatcher {
    ServiceRecognitionResponse match(String query, List<ServiceItemDTO> candidates);
}
