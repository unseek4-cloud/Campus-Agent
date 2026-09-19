package com.campusagent.aiintegration.rag;

/** Conversation text used to resolve the current question's references. */
public record ConversationMessage(String role, String content) {
}
