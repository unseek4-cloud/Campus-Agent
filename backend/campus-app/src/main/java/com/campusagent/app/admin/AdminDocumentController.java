package com.campusagent.app.admin;

import com.campusagent.shared.api.ApiResponse;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@RestController
@RequestMapping("/api/admin")
public class AdminDocumentController {
    private final AdminDocumentService service;
    public AdminDocumentController(AdminDocumentService service) { this.service=service; }

    @GetMapping("/overview") public ApiResponse<Map<String,Object>> overview() { return ApiResponse.success(service.stats()); }
    @GetMapping("/config") public ApiResponse<Map<String,Long>> config() { return ApiResponse.success(Map.of("maxUploadSizeMb",service.maxUploadSizeMb())); }
    @GetMapping("/documents") public ApiResponse<Map<String,Object>> list(
            @RequestParam(required=false) String search,@RequestParam(required=false) String type,
            @RequestParam(required=false) String status,@RequestParam(defaultValue="1") int page,
            @RequestParam(defaultValue="20") int pageSize) {
        return ApiResponse.success(service.list(search,type,status,page,pageSize));
    }
    @GetMapping("/documents/{id}") public ApiResponse<DocumentRecord> detail(@PathVariable String id) { return ApiResponse.success(service.detail(id)); }
    @PostMapping("/documents") public ApiResponse<Map<String,Object>> upload(@RequestPart("file") MultipartFile file) { return ApiResponse.success(service.upload(file)); }
    @PatchMapping("/documents/{id}/name") public ApiResponse<DocumentRecord> rename(@PathVariable String id,@RequestBody Map<String,String> body) { return ApiResponse.success(service.rename(id,body.get("name"))); }
    @DeleteMapping("/documents/{id}") public ApiResponse<Map<String,Boolean>> delete(@PathVariable String id) { service.delete(id); return ApiResponse.success(Map.of("deleted",true)); }
    @PostMapping("/documents/{id}/reprocess") public ApiResponse<DocumentRecord> reprocess(@PathVariable String id) { return ApiResponse.success(service.reprocess(id)); }
}
