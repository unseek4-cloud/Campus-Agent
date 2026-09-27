package com.campusagent.identity.security;

import com.campusagent.identity.user.UserView;
import java.security.Principal;

public record UserPrincipal(UserView user, String sessionId) implements Principal {
    @Override public String getName() { return user.username(); }
}
