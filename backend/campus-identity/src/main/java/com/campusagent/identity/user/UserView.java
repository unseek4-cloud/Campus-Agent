package com.campusagent.identity.user;

/** The only account representation returned to the browser. */
public record UserView(long id, String username, String displayName, String role, String studentNo,
                       String department, String major, String className) {}
