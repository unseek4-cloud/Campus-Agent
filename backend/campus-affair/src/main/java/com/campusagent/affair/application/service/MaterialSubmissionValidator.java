package com.campusagent.affair.application.service;

import com.campusagent.affair.application.dto.ApplicationDetail.MaterialRequirement;
import java.util.*;

/** Validate ownership and required-item coverage before storing any files. Content is reviewed separately. */
public final class MaterialSubmissionValidator {
    private MaterialSubmissionValidator() {}
    public static List<String> validate(List<MaterialRequirement> materials, int fileCount,
            List<String> submittedIds, boolean requireAll) {
        var ids = submittedIds == null || submittedIds.isEmpty()
                ? Collections.nCopies(fileCount, "") : submittedIds;
        if (ids.size() != fileCount) throw new IllegalArgumentException("每个附件必须对应一项材料，请重新选择文件");
        var allowed = new HashSet<String>();
        for (var material : materials) allowed.add(material.id());
        var normalized = new ArrayList<String>();
        for (var id : ids) {
            String value = id == null ? "" : id.trim();
            if (!value.isEmpty() && !allowed.contains(value)) throw new IllegalArgumentException("附件对应的材料不属于本次申请");
            normalized.add(value);
        }
        if (requireAll) {
            var missing = materials.stream().filter(m -> m.required() && !normalized.contains(m.id())).map(MaterialRequirement::name).toList();
            if (!missing.isEmpty()) throw new IllegalArgumentException("请逐项上传必交材料：" + String.join("、", missing));
        }
        return List.copyOf(normalized);
    }
}
