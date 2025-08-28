// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFastifyLoggerAdapter } from "../src/utils/fastifyLoggerAdapter";
import { Logger, LogLevel } from "../src/types";

describe("FastifyLoggerAdapter", () => {
  let mockLogger: Logger;
  let fastifyLogger: any;

  beforeEach(() => {
    // Create mock logger with spies
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Create adapter
    fastifyLogger = createFastifyLoggerAdapter(mockLogger);
  });

  describe("Basic string logging", () => {
    it("should forward info messages to project logger", () => {
      fastifyLogger.info("test message");
      expect(mockLogger.info).toHaveBeenCalledWith("test message");
    });

    it("should forward error messages to project logger", () => {
      fastifyLogger.error("error message");
      expect(mockLogger.error).toHaveBeenCalledWith("error message");
    });

    it("should forward debug messages to project logger", () => {
      fastifyLogger.debug("debug message");
      expect(mockLogger.debug).toHaveBeenCalledWith("debug message");
    });

    it("should forward warn messages to project logger", () => {
      fastifyLogger.warn("warning message");
      expect(mockLogger.warn).toHaveBeenCalledWith("warning message");
    });
  });

  describe("Additional Fastify methods", () => {
    it("should map fatal to error with [FATAL] prefix", () => {
      fastifyLogger.fatal("fatal error");
      expect(mockLogger.error).toHaveBeenCalledWith("[FATAL] fatal error");
    });

    it("should map trace to debug with [TRACE] prefix", () => {
      fastifyLogger.trace("trace message");
      expect(mockLogger.debug).toHaveBeenCalledWith("[TRACE] trace message");
    });
  });

  describe("Object logging", () => {
    it("should stringify objects when no message provided", () => {
      const obj = { key: "value", number: 42 };
      fastifyLogger.info(obj);
      expect(mockLogger.info).toHaveBeenCalledWith(JSON.stringify(obj));
    });

    it("should combine object and message", () => {
      const obj = { request: "data" };
      fastifyLogger.info(obj, "request received");
      expect(mockLogger.info).toHaveBeenCalledWith(
        "request received " + JSON.stringify(obj),
      );
    });

    it("should handle Error objects specially", () => {
      const error = new Error("Test error");
      fastifyLogger.error(error);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Test error"),
      );
    });

    it("should handle error in object with message", () => {
      const error = new Error("Test error");
      fastifyLogger.error({ err: error }, "Request failed");
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Request failed: Test error"),
      );
    });
  });

  describe("child() method", () => {
    it("should return a logger with same methods", () => {
      const child = fastifyLogger.child({ requestId: "123" });

      expect(child).toHaveProperty("info");
      expect(child).toHaveProperty("error");
      expect(child).toHaveProperty("debug");
      expect(child).toHaveProperty("warn");
      expect(child).toHaveProperty("fatal");
      expect(child).toHaveProperty("trace");
      expect(child).toHaveProperty("child");
    });

    it("should forward child logger calls to parent logger", () => {
      const child = fastifyLogger.child({ requestId: "123" });
      child.info("child message");
      expect(mockLogger.info).toHaveBeenCalledWith("child message");
    });
  });

  describe("Edge cases", () => {
    it("should handle null values", () => {
      fastifyLogger.info(null);
      expect(mockLogger.info).toHaveBeenCalledWith("null");
    });

    it("should handle undefined values", () => {
      fastifyLogger.info(undefined);
      expect(mockLogger.info).toHaveBeenCalledWith("undefined");
    });

    it("should handle number values", () => {
      fastifyLogger.info(42);
      expect(mockLogger.info).toHaveBeenCalledWith("42");
    });

    it("should handle boolean values", () => {
      fastifyLogger.info(true);
      expect(mockLogger.info).toHaveBeenCalledWith("true");
    });

    it("should handle arrays", () => {
      const arr = [1, 2, 3];
      fastifyLogger.info(arr);
      expect(mockLogger.info).toHaveBeenCalledWith("[1,2,3]");
    });
  });

  describe("Complex scenarios", () => {
    it("should handle nested objects", () => {
      const nested = {
        level1: {
          level2: {
            value: "deep",
          },
        },
      };
      fastifyLogger.info(nested, "nested object");
      expect(mockLogger.info).toHaveBeenCalledWith(
        "nested object " + JSON.stringify(nested),
      );
    });

    it("should handle error with stack trace", () => {
      const error = new Error("Test error");
      error.stack = "Error: Test error\n    at test.js:10:5";
      fastifyLogger.error({ err: error }, "Operation failed");

      const call = (mockLogger.error as any).mock.calls[0][0];
      expect(call).toContain("Operation failed: Test error");
      expect(call).toContain("at test.js:10:5");
    });

    it("should handle non-Error objects in err field", () => {
      fastifyLogger.error({ err: { custom: "error" } }, "Custom error");
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Custom error: {"custom":"error"}',
      );
    });
  });

  describe("Logger configuration properties", () => {
    it("should set level property from logLevel parameter", () => {
      const adapter = createFastifyLoggerAdapter(mockLogger, "debug");
      expect(adapter.level).toBe("debug");
    });

    it("should default level to info when no logLevel provided", () => {
      const adapter = createFastifyLoggerAdapter(mockLogger);
      expect(adapter.level).toBe("info");
    });

    it("should set silent to true when logLevel is ignore", () => {
      const adapter = createFastifyLoggerAdapter(mockLogger, "ignore");
      expect(adapter.silent).toBe(true);
      expect(adapter.level).toBe("ignore");
    });

    it("should set silent to false for non-ignore levels", () => {
      const levels: LogLevel[] = ["debug", "info", "warn", "error"];
      levels.forEach((level) => {
        const adapter = createFastifyLoggerAdapter(mockLogger, level);
        expect(adapter.silent).toBe(false);
        expect(adapter.level).toBe(level);
      });
    });

    it("should always have empty msgPrefix", () => {
      const adapter = createFastifyLoggerAdapter(mockLogger, "error");
      expect(adapter.msgPrefix).toBe("");
    });
  });
});
