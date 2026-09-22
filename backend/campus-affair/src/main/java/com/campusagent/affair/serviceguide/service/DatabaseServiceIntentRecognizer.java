package com.campusagent.affair.serviceguide.service;

import com.campusagent.affair.serviceguide.dto.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import java.text.Normalizer;
import java.util.List;
import java.util.Locale;

@Service
public class DatabaseServiceIntentRecognizer implements ServiceIntentRecognizer {
    private static final Logger log = LoggerFactory.getLogger(DatabaseServiceIntentRecognizer.class);
    private final ServiceGuideService catalog;
    private final SemanticIntentMatcher semantic;
    public DatabaseServiceIntentRecognizer(ServiceGuideService catalog, SemanticIntentMatcher semantic) {
        this.catalog = catalog; this.semantic = semantic;
    }
    @Override
    public ServiceRecognitionResponse recognize(String query) {
        if (query == null || query.isBlank() || query.length() > 4000) throw new IllegalArgumentException("请输入 1–4000 字的问题");
        String q = normalize(query);
        log.info("[ServiceIntent] query={}", query.replaceAll("[\\r\\n\\t]", " ").substring(0, Math.min(query.length(), 160)));
        try {
            var items = catalog.list(true);
            var candidates = items.stream().filter(s -> !contains(q, s.recognitionRules().exclusions())).toList();
            var strong = candidates.stream().filter(s -> contains(q, s.recognitionRules().subjects()) && contains(q, s.recognitionRules().actions())).toList();
            // Negation/multiple requests need semantic confirmation; never pick the first catalog row.
            if (strong.size() == 1 && !q.matches(".*(不想|不要|不用|不是|不需要|无需).*")) return matched(strong.getFirst(), 0.93);
            if (!strong.isEmpty() || q.matches(".*(怎么办|怎么|如何|我要|我想|申请|办理|补办|报修|参加).*")) {
                var result = semantic.match(query, candidates);
                if (result != null && result.matched() && result.confidence() != null && Double.isFinite(result.confidence()) && result.confidence() >= 0.85 && result.confidence() <= 1) {
                    var item = candidates.stream().filter(s -> s.code().equals(result.serviceCode())).findFirst();
                    if (item.isPresent()) return matched(item.get(), result.confidence());
                }
            }
        } catch (DataAccessException e) {
            log.warn("[ServiceIntent] catalog unavailable; falling back to QA");
        } catch (RuntimeException e) {
            log.warn("[ServiceIntent] recognition unavailable: {}", e.getClass().getSimpleName());
        }
        log.info("[ServiceIntent] matched=false");
        return ServiceRecognitionResponse.unmatched();
    }
    private ServiceRecognitionResponse matched(ServiceItemDTO item, double confidence) {
        log.info("[ServiceIntent] matched={}", item.code());
        return ServiceRecognitionResponse.match(item, confidence);
    }
    private static boolean contains(String query, List<String> terms) {
        return terms != null && terms.stream().anyMatch(t -> t != null && !t.isBlank() && query.contains(normalize(t)));
    }
    private static String normalize(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFKC).replaceAll("[\\p{P}\\s]", "").toLowerCase(Locale.ROOT);
    }
}
