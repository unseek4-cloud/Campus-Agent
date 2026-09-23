package com.campusagent.shared.storage;

import com.campusagent.shared.error.BusinessException;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import java.io.IOException;
import java.nio.file.*;

/** Shared UUID-only disk storage; original names never become filesystem paths. */
public final class LocalFileStorage {
    private final Path root;
    public LocalFileStorage(String root) { this.root = Path.of(root).toAbsolutePath().normalize(); }
    private Path path(String id) {
        if (id == null || !id.matches("[a-fA-F0-9-]{36}")) throw new IllegalArgumentException("文件 ID 无效");
        return root.resolve(id);
    }
    public void write(String id, byte[] bytes) throws IOException {
        Files.createDirectories(root);
        Path target = path(id);
        // CREATE_NEW prevents overwriting an existing file, including a symbolic link.
        var output = Files.newOutputStream(target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        boolean complete = false;
        try (output) { output.write(bytes); complete = true; }
        finally { if (!complete) Files.deleteIfExists(target); }
    }
    public boolean exists(String id) { return Files.isRegularFile(path(id), LinkOption.NOFOLLOW_LINKS); }
    public byte[] read(String id) throws IOException {
        if (!exists(id)) throw new NoSuchFileException("Stored file unavailable");
        return Files.readAllBytes(path(id));
    }
    public Resource resource(String id) {
        if (!exists(id)) throw new BusinessException("FILE_NOT_FOUND", "文件暂不可用", HttpStatus.NOT_FOUND);
        return new FileSystemResource(path(id));
    }
    public void delete(String id) throws IOException { Files.deleteIfExists(path(id)); }
}
