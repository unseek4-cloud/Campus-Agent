package com.campusagent.affair.serviceguide.dto;

import java.util.List;

public record ServiceStepDTO(Long id, int order, String title, String description,
        String responsibleDepartment, List<String> requiredMaterials, String location, String estimatedTime) { }
