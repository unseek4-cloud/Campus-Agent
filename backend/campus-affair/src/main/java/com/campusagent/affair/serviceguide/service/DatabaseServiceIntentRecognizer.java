package com.campusagent.affair.serviceguide.service;

import com.campusagent.affair.serviceguide.dto.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Service
public class DatabaseServiceIntentRecognizer implements ServiceIntentRecognizer {
    private static final Logger log = LoggerFactory.getLogger(DatabaseServiceIntentRecognizer.class);
    // Older catalogs used these question words to suppress guides. They are not topic exclusions;
    // QueryIntent now decides the response without editing administrator-owned catalog data.
    private static final Set<String> LEGACY_QUERY_EXCLUSIONS = Set.of("什么时候", "几点", "时间", "对象", "在哪里");
    private final ServiceGuideService catalog;
    private final SemanticIntentMatcher semantic;
    public DatabaseServiceIntentRecognizer(ServiceGuideService catalog, SemanticIntentMatcher semantic) {
        this.catalog = catalog; this.semantic = semantic;
    }
    @Override
    public ServiceRecognitionResponse recognize(String query) {
        if (query == null || query.isBlank() || query.length() > 4000) throw new IllegalArgumentException("请输入 1–4000 字的问题");
        String q = normalize(query);
        QueryIntent ruleIntent = QueryIntentRules.classify(query);
        ServiceItemDTO related = null;
        log.info("[ServiceIntent] query={}", query.replaceAll("[\\r\\n\\t]", " ").substring(0, Math.min(query.length(), 160)));
        try {
            var items = catalog.list(true);
            var candidates = items.stream().filter(s -> !excluded(q, s.recognitionRules().exclusions())).toList();
            var subjects = candidates.stream().filter(s -> contains(q, s.recognitionRules().subjects())).toList();
            boolean negated = q.matches(".*(不想|不要|不用|不是|不需要|无需).*");
            // Topic recognition is independent of action words and cannot authorize a guide.
            if (subjects.size() == 1 && !negated) related = subjects.getFirst();
            // Broad subjects such as "宿舍" cannot map every procedural question to "宿舍报修".
            // Keep catalog action rules for identifying the service, not for deciding query intent.
            if (related != null && ruleIntent != null && (ruleIntent != QueryIntent.SERVICE_GUIDE
                    || contains(q, related.recognitionRules().actions()) || q.contains(normalize(related.name()))))
                return matched(related, 0.93, ruleIntent);
            if (!subjects.isEmpty() || q.matches(".*(怎么办|怎么|如何|我要|我想|申请|办理|补办|报修|参加).*")) {
                var result = semantic.match(query, candidates);
                if (result != null && result.matched() && result.confidence() != null && Double.isFinite(result.confidence()) && result.confidence() >= 0.85 && result.confidence() <= 1) {
                    var item = candidates.stream().filter(s -> s.code().equals(result.serviceCode())).findFirst();
                    if (item.isPresent()) return matched(item.get(), result.confidence(),
                            ruleIntent == null || ruleIntent == QueryIntent.SERVICE_GUIDE ? result.queryIntent() : ruleIntent);
                }
            }
        } catch (DataAccessException e) {
            log.warn("[ServiceIntent] catalog unavailable; falling back to QA");
        } catch (RuntimeException e) {
            log.warn("[ServiceIntent] recognition unavailable: {}", e.getClass().getSimpleName());
        }
        // A failed semantic call may retain the known topic, but must never infer a workflow.
        QueryIntent fallback = ruleIntent == null ? QueryIntent.GENERAL_QA : ruleIntent;
        if (related != null && fallback != QueryIntent.SERVICE_GUIDE) return matched(related, 0.93, fallback);
        log.info("[ServiceIntent] matched=false queryIntent={}", fallback);
        return ServiceRecognitionResponse.unmatched(fallback);
    }
    private ServiceRecognitionResponse matched(ServiceItemDTO item, double confidence, QueryIntent intent) {
        log.info("[ServiceIntent] matched={} queryIntent={}", item.code(), intent);
        return ServiceRecognitionResponse.match(item, confidence, intent);
    }
    private static boolean contains(String query, List<String> terms) {
        return terms != null && terms.stream().anyMatch(t -> t != null && !t.isBlank() && query.contains(normalize(t)));
    }
    private static boolean excluded(String query, List<String> terms) {
        return terms != null && contains(query, terms.stream()
                .filter(t -> t != null && !LEGACY_QUERY_EXCLUSIONS.contains(normalize(t))).toList());
    }
    private static String normalize(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFKC).replaceAll("[\\p{P}\\s]", "").toLowerCase(Locale.ROOT);
    }
}
