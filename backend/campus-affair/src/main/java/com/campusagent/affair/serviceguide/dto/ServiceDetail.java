package com.campusagent.affair.serviceguide.dto;

import java.util.List;

public record ServiceDetail(ServiceItemDTO service, List<ServiceStepDTO> steps) { }
