package com.campusagent.aiintegration.history;

import com.campusagent.aiintegration.history.ChatHistoryTypes.*;
import com.campusagent.shared.error.BusinessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.*;

/**
 * 对话公开分享：token 是唯一凭证。
 * 拥有者用登录态创建 / 撤销链接；访客只需要 token，走 /api/share/** 只读读取，
 * 因此不需要账号，也不会暴露归属账号、requestId 或调试字段。
 */
@Service
public class ChatShareService {
    /** 默认有效期；创建时可用 ttlDays 覆盖，最长一年。 */
    public static final int DEFAULT_TTL_DAYS = 30;
    private static final int MAX_TTL_DAYS = 365;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final ChatHistoryRepository repository;
    private final TransactionTemplate transaction;

    public ChatShareService(ChatHistoryRepository repository, PlatformTransactionManager manager) {
        this.repository = repository;
        this.transaction = new TransactionTemplate(manager);
    }

    /** 创建或复用一条有效分享链接：同样的会话 + 同样的消息选择不会重复产生 token。 */
    public Share share(long userId, long conversationId, Integer ttlDays, List<Long> requestedIds) {
        int days = ttlDays == null || ttlDays <= 0 ? DEFAULT_TTL_DAYS : Math.min(ttlDays, MAX_TTL_DAYS);
        var ids = requestedIds == null ? List.<Long>of()
                : requestedIds.stream().filter(Objects::nonNull).distinct().sorted().toList();
        return transaction.execute(s -> {
            var conversation = repository.owned(userId, conversationId, true);
            if (!ids.isEmpty()) {
                var owned = repository.messages(userId, conversationId).stream().map(Message::id).collect(java.util.stream.Collectors.toSet());
                if (!owned.containsAll(ids)) throw new BusinessException("SHARE_MESSAGE_NOT_FOUND", "所选消息不属于该会话", HttpStatus.BAD_REQUEST);
            }
            var existing = repository.activeShare(userId, conversationId);
            if (existing != null && existing.messageIds().equals(ids)) return existing;
            return repository.createShare(userId, conversationId, token(), conversation.title(),
                    LocalDateTime.now().plusDays(days), ids);
        });
    }

    public List<Share> shares(long userId, long conversationId) {
        return transaction.execute(s -> {
            repository.owned(userId, conversationId, false);
            return repository.shares(userId, conversationId);
        });
    }

    public void revoke(long userId, long conversationId, String token) {
        transaction.executeWithoutResult(s -> {
            repository.owned(userId, conversationId, false);
            var share = repository.share(token);
            if (share == null || share.conversationId() != conversationId) throw notFound();
            repository.revokeShare(userId, conversationId, token);
        });
    }

    /** 公开只读视图：token 有效即返回；撤销、过期、不存在都按“链接失效”处理。 */
    public SharedConversation view(String token) {
        if (token == null || token.isBlank()) throw notFound();
        return transaction.execute(s -> {
            var share = repository.share(token.trim());
            if (share == null || share.revoked()) throw notFound();
            if (share.expiresAt() != null && !share.expiresAt().isAfter(LocalDateTime.now())) throw notFound();
            var conversation = repository.conversation(share.conversationId());
            if (conversation == null) throw notFound();
            repository.viewed(share.token());
            var messages = repository.sharedMessages(share.conversationId(), share.messageIds()).stream()
                    .map(m -> new SharedMessage(m.role(), m.content(), m.response(), m.createdAt()))
                    .toList();
            return new SharedConversation(conversation.title(), share.createdAt(), share.expiresAt(),
                    share.viewCount() + 1, share.messageIds(), messages);
        });
    }

    /** 32 字节随机 → URL-safe base64（43 字符），可安全放进链接与路径变量。 */
    private static String token() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static BusinessException notFound() {
        return new BusinessException("SHARE_NOT_FOUND", "分享链接不存在或已失效", HttpStatus.NOT_FOUND);
    }
}
