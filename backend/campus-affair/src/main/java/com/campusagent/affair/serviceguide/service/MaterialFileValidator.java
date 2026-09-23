package com.campusagent.affair.serviceguide.service;

import com.campusagent.shared.error.BusinessException;
import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.ZipInputStream;

/** Template formats differ from knowledge ingestion: these files are never parsed by AI. */
public final class MaterialFileValidator {
    public static final Map<String, String> TYPES = Map.of(
            "doc", "application/msword", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "pdf", "application/pdf", "xls", "application/vnd.ms-excel",
            "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "zip", "application/zip");
    public record Validated(String filename, String contentType, byte[] bytes) { }
    public static Validated validate(MultipartFile file, long maxBytes) throws IOException {
        String name = Optional.ofNullable(file.getOriginalFilename()).orElse("").replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1);
        if (name.isBlank() || name.length() > 255 || name.chars().anyMatch(c -> c < 32 || c == 127))
            throw new IllegalArgumentException("文件名无效或过长");
        String type = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        if (!TYPES.containsKey(type)) throw new BusinessException("UNSUPPORTED_ATTACHMENT_TYPE", "仅支持 DOC、DOCX、PDF、XLS、XLSX、ZIP", HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        if (file.isEmpty()) throw new IllegalArgumentException("文件为空");
        if (file.getSize() > maxBytes) throw tooLarge();
        byte[] bytes;
        try (var in = file.getInputStream()) { bytes = in.readNBytes(Math.toIntExact(maxBytes + 1)); }
        if (bytes.length > maxBytes) throw tooLarge();
        boolean valid = switch (type) {
            case "pdf" -> new String(bytes, 0, Math.min(bytes.length, 5), StandardCharsets.US_ASCII).equals("%PDF-");
            case "doc", "xls" -> bytes.length >= 8 && Arrays.equals(Arrays.copyOf(bytes, 8),
                    new byte[]{(byte)0xd0,(byte)0xcf,0x11,(byte)0xe0,(byte)0xa1,(byte)0xb1,0x1a,(byte)0xe1});
            default -> validZip(bytes, type);
        };
        if (!valid) throw new BusinessException("INVALID_ATTACHMENT", "文件内容与格式不符或文件已损坏", HttpStatus.UNPROCESSABLE_ENTITY);
        return new Validated(name, TYPES.get(type), bytes);
    }
    private static boolean validZip(byte[] bytes, String type) {
        if (bytes.length < 4 || bytes[0] != 'P' || bytes[1] != 'K') return false;
        boolean document = false, manifest = false;
        int entries = 0; long expanded = 0;
        try (var zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            java.util.zip.ZipEntry entry;
            byte[] buffer = new byte[8192];
            while ((entry = zip.getNextEntry()) != null) {
                if (++entries > 4096) return false;
                if (entry.getName().equals("[Content_Types].xml")) manifest = true;
                if (entry.getName().equals(type.equals("docx") ? "word/document.xml" : "xl/workbook.xml")) document = true;
                int read;
                while ((read = zip.read(buffer)) != -1) {
                    expanded += read;
                    if (expanded > 100L * 1024 * 1024) return false;
                }
            }
            return type.equals("zip") ? entries > 0 || bytes[2] == 5 && bytes[3] == 6 : document && manifest;
        } catch (IOException failure) { return false; }
    }
    private static BusinessException tooLarge() { return new BusinessException("ATTACHMENT_TOO_LARGE", "文件超过大小限制", HttpStatus.PAYLOAD_TOO_LARGE); }
}
