package com.campusagent.affair.application.service;

import com.campusagent.affair.serviceguide.service.MaterialFileValidator;
import com.campusagent.shared.error.BusinessException;
import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.util.*;

/** Reuses document signature validation; adds image signatures for student evidence. */
public final class ApplicationFileValidator {
    public static final Map<String,String> TYPES = Map.of("pdf", "application/pdf", "doc", "application/msword",
            "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "jpg", "image/jpeg", "jpeg", "image/jpeg", "png", "image/png");
    public static MaterialFileValidator.Validated validate(MultipartFile file, long maxBytes) throws IOException {
        String name = Optional.ofNullable(file.getOriginalFilename()).orElse("");
        if (name.isBlank() || name.length() > 255 || name.contains("/") || name.contains("\\") || name.contains("..")
                || name.chars().anyMatch(c -> c < 32 || c == 127 || ":*?\"<>|".indexOf(c) >= 0))
            throw new IllegalArgumentException("文件名无效，请重命名后上传");
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String expected = TYPES.get(extension);
        if (expected == null) throw new BusinessException("UNSUPPORTED_ATTACHMENT_TYPE", "仅支持 PDF、DOC、DOCX、JPG、JPEG、PNG", HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        String mime = Optional.ofNullable(file.getContentType()).orElse("").split(";",2)[0].trim().toLowerCase(Locale.ROOT);
        if (!expected.equals(mime) && !"application/octet-stream".equals(mime))
            throw new BusinessException("INVALID_ATTACHMENT_MIME", "文件 MIME 类型与扩展名不符", HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        if (!extension.equals("png") && !extension.equals("jpg") && !extension.equals("jpeg"))
            return MaterialFileValidator.validate(file, maxBytes);
        if (file.isEmpty()) throw new IllegalArgumentException("文件为空");
        if (file.getSize() > maxBytes) throw tooLarge();
        byte[] bytes;
        try (var in = file.getInputStream()) { bytes = in.readNBytes(Math.toIntExact(maxBytes + 1)); }
        if (bytes.length > maxBytes) throw tooLarge();
        boolean valid = extension.equals("png")
                ? bytes.length >= 24 && Arrays.equals(Arrays.copyOf(bytes,8), new byte[]{(byte)137,80,78,71,13,10,26,10})
                : bytes.length >= 4 && (bytes[0]&255)==255 && (bytes[1]&255)==216 && (bytes[2]&255)==255;
        if (!valid) throw new BusinessException("INVALID_ATTACHMENT", "文件内容与格式不符或文件已损坏", HttpStatus.UNPROCESSABLE_ENTITY);
        return new MaterialFileValidator.Validated(name, expected, bytes);
    }
    private static BusinessException tooLarge() { return new BusinessException("ATTACHMENT_TOO_LARGE", "文件超过大小限制", HttpStatus.PAYLOAD_TOO_LARGE); }
    private ApplicationFileValidator() {}
}
