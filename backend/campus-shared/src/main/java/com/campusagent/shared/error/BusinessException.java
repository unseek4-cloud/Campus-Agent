package com.campusagent.shared.error;

import org.springframework.http.HttpStatus;

/** 可预期的业务异常基类；具体领域后续定义自己的稳定错误码。 */
public class BusinessException extends RuntimeException {
    private final String code;
    private final HttpStatus status;

    public BusinessException(String code, String message, HttpStatus status) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public String getCode() {
        return code;
    }

    public HttpStatus getStatus() {
        return status;
    }
}

