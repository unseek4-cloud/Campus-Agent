package com.campusagent.identity.user;

import com.fasterxml.jackson.annotation.JsonIgnore;

public record UserAccount(UserView user, @JsonIgnore String passwordHash, String status) {
    public boolean active() { return "ACTIVE".equals(status); }
    @Override public String toString() { return "UserAccount[id=" + user.id() + "]"; }
}
