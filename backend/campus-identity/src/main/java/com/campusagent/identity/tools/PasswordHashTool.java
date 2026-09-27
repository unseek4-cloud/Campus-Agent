package com.campusagent.identity.tools;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Local command-line helper only. No Spring context or HTTP endpoint. */
public final class PasswordHashTool {
    public static void main(String[] args) throws IOException {
        char[] password;
        if (System.console() != null) password = System.console().readPassword("Password (hidden): ");
        else {
            String line = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).readLine();
            if (line == null) throw new IllegalArgumentException("Supply one password via standard input");
            password = line.toCharArray();
        }
        try {
            String value = new String(password);
            if (value.isEmpty() || value.getBytes(StandardCharsets.UTF_8).length > 72)
                throw new IllegalArgumentException("Password must contain 1-72 UTF-8 bytes");
            System.out.println(new BCryptPasswordEncoder(10).encode(value));
        } finally { Arrays.fill(password, '\0'); }
    }
}
