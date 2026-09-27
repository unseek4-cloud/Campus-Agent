package com.campusagent.identity.security;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.stereotype.Service;
import javax.crypto.spec.SecretKeySpec;
import java.time.Instant;
import java.util.Base64;

@Service
public class JwtService {
    private final JwtEncoder encoder;
    private final JwtDecoder decoder;
    private final long expireMinutes;
    public JwtService(@Value("${campus.auth.jwt-secret:}") String secret,
                      @Value("${campus.auth.expire-minutes:120}") long expireMinutes) {
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(secret); }
        catch (IllegalArgumentException e) { throw new IllegalStateException("JWT_SECRET must be Base64 encoded random bytes"); }
        if (bytes.length < 32) throw new IllegalStateException("JWT_SECRET must contain at least 32 random bytes (Base64 encoded)");
        if (expireMinutes < 1 || expireMinutes > 10080) throw new IllegalStateException("JWT_EXPIRE_MINUTES must be between 1 and 10080");
        this.expireMinutes = expireMinutes;
        var key = new SecretKeySpec(bytes, "HmacSHA256");
        encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        var nimbus = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        nimbus.setJwtValidator(JwtValidators.createDefaultWithIssuer("campus-agent"));
        decoder = nimbus;
    }
    public Instant expiresAt() { return Instant.now().plusSeconds(expireMinutes * 60); }
    public String issue(long userId, String sessionId, Instant expires) {
        var claims = JwtClaimsSet.builder().issuer("campus-agent").subject(Long.toString(userId))
                .id(sessionId).issuedAt(Instant.now()).expiresAt(expires).build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    }
    public Jwt decode(String value) { return decoder.decode(value); }
}
