package com.campusagent.app.knowledge;

import com.campusagent.app.admin.*;
import com.campusagent.shared.error.*;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class KnowledgeDocumentControllerTest {
    @Test void originalPoliciesUseSafePreviewTypesAndDownloadOfficeFiles() throws Exception {
        var service=mock(AdminDocumentService.class);
        var mvc=MockMvcBuilders.standaloneSetup(new KnowledgeDocumentController(service)).build();
        for (String type : new String[]{"pdf","txt","md","png","docx"}) {
            String name="学校政策."+type;
            var document=new DocumentRecord("doc","campus-default",name,name,type,"application/octet-stream",4,"hash","SUCCESS",1,null,null,null);
            when(service.detail("doc")).thenReturn(document);
            when(service.originalFile("doc")).thenReturn(new ByteArrayResource(new byte[]{1,2,3,4}));
            var response=mvc.perform(get("/api/knowledge/documents/doc/file")).andExpect(status().isOk())
                    .andExpect(header().string("X-Content-Type-Options","nosniff")).andReturn().getResponse();
            var disposition=ContentDisposition.parse(response.getHeader("Content-Disposition"));
            assertEquals(name,disposition.getFilename());assertEquals(type.equals("docx")?"attachment":"inline",disposition.getType());
            if(type.equals("pdf"))assertEquals("application/pdf",response.getContentType());
            if(type.equals("md"))assertTrue(response.getContentType().startsWith("text/plain"));
            assertArrayEquals(new byte[]{1,2,3,4},response.getContentAsByteArray());
        }
    }
    @Test void unavailableAndOutOfScopeDocumentsNeverReturnFiles() throws Exception {
        var service=mock(AdminDocumentService.class);
        var mvc=MockMvcBuilders.standaloneSetup(new KnowledgeDocumentController(service)).setControllerAdvice(new GlobalExceptionHandler()).build();
        when(service.detail("failed")).thenReturn(new DocumentRecord("failed","campus-default","a.pdf","a.pdf","pdf","application/pdf",4,"hash","FAILED",0,null,null,null));
        mvc.perform(get("/api/knowledge/documents/failed/file")).andExpect(status().isNotFound());
        when(service.detail("other-base")).thenThrow(new BusinessException("DOCUMENT_NOT_FOUND","文档不存在",HttpStatus.NOT_FOUND));
        mvc.perform(get("/api/knowledge/documents/other-base/file")).andExpect(status().isNotFound());
        verify(service,never()).originalFile(anyString());
    }
}
