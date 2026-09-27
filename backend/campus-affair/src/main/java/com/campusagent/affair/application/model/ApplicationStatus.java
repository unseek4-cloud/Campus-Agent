package com.campusagent.affair.application.model;

public enum ApplicationStatus {
    SUBMITTED, REVIEWING, NEED_MORE, APPROVED, REJECTED, COMPLETED;

    public boolean active() { return this != REJECTED && this != COMPLETED; }
    public boolean canReviewTo(ApplicationStatus next) {
        return switch (this) {
            case SUBMITTED -> next == REVIEWING;
            case REVIEWING -> next == NEED_MORE || next == APPROVED || next == REJECTED;
            case APPROVED -> next == COMPLETED;
            default -> false;
        };
    }
}
