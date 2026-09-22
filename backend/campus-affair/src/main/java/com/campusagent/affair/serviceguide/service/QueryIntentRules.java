package com.campusagent.affair.serviceguide.service;

import com.campusagent.affair.serviceguide.dto.QueryIntent;
import java.text.Normalizer;
import java.util.regex.Pattern;

/** High precision question patterns; uncertain expressions require semantic classification. */
public final class QueryIntentRules {
    private QueryIntentRules() { }
    private static final Pattern NEGATED = Pattern.compile("(不想|不要|不需要|无需|不用).{0,8}(办理|申请|补办|报修|流程|步骤|操作)");
    private static final Pattern ELIGIBILITY = Pattern.compile(
            "申请条件|办理条件|资格|符合|及格|允许|能不能|能否|可否|可不可以|是否可|是否能|能申请|能办理|还能评|可以(申请|办理|补办|参加|评)|"
            + "(成绩|分数|绩点).{0,12}(要求|条件)|\\d+(?:\\.\\d+)?分.{0,12}(要求|条件|能|可|符合)|对.{0,8}(成绩|绩点).{0,8}要求");
    private static final Pattern POLICY = Pattern.compile(
            "收费|费用|多少钱|多少费用|截止|什么时候|几点|何时|政策|规定|必须|强制|是否需要参加|要不要参加|是否允许|"
            + "(对象|时间).{0,6}(是谁|哪些|什么)");
    private static final Pattern GUIDE = Pattern.compile(
            "(怎么|如何|怎样|哪里|哪儿|何处).{0,10}(办理|申请|申报|补办|报修|操作|参加|提交|请假|做|处理)|怎么办|"
            + "(办理|申请|补办|报修|操作)(流程|步骤)|具体步骤|"
            + "(需要|要|准备|提交|带).{0,8}(什么|哪些|什么样的)材料|需要准备.{0,4}材料|"
            + "(我要|我想|我准备|我打算|帮我|带我).{0,6}(办理|申请|补办|报修|申报|参加|请假)");

    /** null means uncertain, never an implicit SERVICE_GUIDE. QA takes priority for mixed requests. */
    public static QueryIntent classify(String query) {
        String q = Normalizer.normalize(query, Normalizer.Form.NFKC).replaceAll("\\s", "");
        if (NEGATED.matcher(q).find()) return QueryIntent.GENERAL_QA;
        if (ELIGIBILITY.matcher(q).find()) return QueryIntent.ELIGIBILITY_QA;
        if (POLICY.matcher(q).find()) return QueryIntent.POLICY_QA;
        if (GUIDE.matcher(q).find()) return QueryIntent.SERVICE_GUIDE;
        if (q.matches(".*(在哪里|在哪儿|在何处)[？?。]*")) return QueryIntent.POLICY_QA;
        return null;
    }
}
