// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createUserService, UserService } from "../src/services/userService";
import { join } from "path";
import { promises as fs } from "fs";
import { createTestDirectory } from "./helpers/test-helper";

describe("Multiple API Passwords", () => {
  let userService: UserService;
  let testDir: string;
  let testCounter = 0;

  beforeEach(async () => {
    // Use a counter to ensure unique directory for each test
    testCounter++;
    testDir = await createTestDirectory(
      "multiple-api-passwords",
      `test-${testCounter}-${Date.now()}`,
    );

    userService = createUserService({
      configDir: testDir,
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      } as any,
    });

    await userService.initialize();
  });

  afterEach(() => {
    userService.destroy();
  });

  describe("API Password Management", () => {
    it("should create user with initial API password", async () => {
      const result = await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      expect(result.user.username).toBe("testuser");
      expect(result.apiPassword).toBeDefined();
      expect(result.apiPassword.length).toBeGreaterThan(20);

      // Verify the user has an initial API password
      const apiPasswords = await userService.listApiPasswords("testuser");
      expect(apiPasswords).toBeDefined();
      expect(apiPasswords!.apiPasswords).toHaveLength(1);
      expect(apiPasswords!.apiPasswords[0].label).toBe("default");
    });

    it("should list API passwords for a user", async () => {
      await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      const result = await userService.listApiPasswords("testuser");
      expect(result).toBeDefined();
      expect(result!.apiPasswords).toHaveLength(1);
      expect(result!.apiPasswords[0].label).toBe("default");
      expect(result!.apiPasswords[0].createdAt).toBeDefined();
    });

    it("should add a new API password with unique label", async () => {
      await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      // Add a small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await userService.addApiPassword(
        "testuser",
        "ci-pipeline",
      );
      expect(result).toBeDefined();
      expect(result!.label).toBe("ci-pipeline");
      expect(result!.apiPassword).toBeDefined();
      expect(result!.apiPassword.length).toBeGreaterThan(20);
      expect(result!.createdAt).toBeDefined();

      // Verify it was added
      const apiPasswords = await userService.listApiPasswords("testuser");
      expect(apiPasswords!.apiPasswords).toHaveLength(2);

      // Should be sorted by createdAt (newest first)
      expect(apiPasswords!.apiPasswords[0].label).toBe("ci-pipeline");
      expect(apiPasswords!.apiPasswords[1].label).toBe("default");
    });

    it("should reject duplicate API password labels", async () => {
      await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      await userService.addApiPassword("testuser", "test-label");

      await expect(
        userService.addApiPassword("testuser", "test-label"),
      ).rejects.toThrow('API password with label "test-label" already exists');
    });

    it("should enforce maximum of 10 API passwords", async () => {
      await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      // Add 9 more passwords (already has 1 default)
      for (let i = 1; i < 10; i++) {
        await userService.addApiPassword("testuser", `label-${i}`);
      }

      // Should fail on the 11th
      await expect(
        userService.addApiPassword("testuser", "label-11"),
      ).rejects.toThrow("Maximum of 10 API passwords allowed per user");
    });

    it("should delete an API password by label", async () => {
      await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      await userService.addApiPassword("testuser", "to-delete");

      const deleteResult = await userService.deleteApiPassword(
        "testuser",
        "to-delete",
      );
      expect(deleteResult.success).toBe(true);
      expect(deleteResult.message).toContain("deleted successfully");

      // Verify it was deleted
      const apiPasswords = await userService.listApiPasswords("testuser");
      expect(apiPasswords!.apiPasswords).toHaveLength(1);
      expect(apiPasswords!.apiPasswords[0].label).toBe("default");
    });

    it("should return error when deleting non-existent API password", async () => {
      await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      const result = await userService.deleteApiPassword(
        "testuser",
        "non-existent",
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("should validate with any of the multiple API passwords", async () => {
      const createResult = await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      const firstPassword = createResult.apiPassword;
      const addResult = await userService.addApiPassword("testuser", "second");
      const secondPassword = addResult!.apiPassword;

      // Both passwords should work
      const user1 = await userService.validateApiPassword(
        "testuser",
        firstPassword,
      );
      expect(user1).toBeDefined();
      expect(user1!.username).toBe("testuser");

      const user2 = await userService.validateApiPassword(
        "testuser",
        secondPassword,
      );
      expect(user2).toBeDefined();
      expect(user2!.username).toBe("testuser");

      // Invalid password should not work
      const user3 = await userService.validateApiPassword(
        "testuser",
        "wrong-password",
      );
      expect(user3).toBeUndefined();
    });

    it("should invalidate deleted API password", async () => {
      const createResult = await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      const addResult = await userService.addApiPassword(
        "testuser",
        "to-delete",
      );
      const passwordToDelete = addResult!.apiPassword;

      // Verify it works before deletion
      let user = await userService.validateApiPassword(
        "testuser",
        passwordToDelete,
      );
      expect(user).toBeDefined();

      // Delete the API password
      await userService.deleteApiPassword("testuser", "to-delete");

      // Verify it no longer works
      user = await userService.validateApiPassword(
        "testuser",
        passwordToDelete,
      );
      expect(user).toBeUndefined();

      // Original password should still work
      user = await userService.validateApiPassword(
        "testuser",
        createResult.apiPassword,
      );
      expect(user).toBeDefined();
    });

    it("should reject empty label", async () => {
      await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      await expect(userService.addApiPassword("testuser", "")).rejects.toThrow(
        "Label cannot be empty",
      );

      await expect(
        userService.addApiPassword("testuser", "   "),
      ).rejects.toThrow("Label cannot be empty");
    });

    it("should reject label exceeding 50 characters", async () => {
      await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      const longLabel = "a".repeat(51);
      await expect(
        userService.addApiPassword("testuser", longLabel),
      ).rejects.toThrow("Label cannot exceed 50 characters");
    });

    it("should return undefined for non-existent user", async () => {
      const listResult = await userService.listApiPasswords("non-existent");
      expect(listResult).toBeUndefined();

      const addResult = await userService.addApiPassword(
        "non-existent",
        "label",
      );
      expect(addResult).toBeUndefined();

      const deleteResult = await userService.deleteApiPassword(
        "non-existent",
        "label",
      );
      expect(deleteResult.success).toBe(false);
      expect(deleteResult.message).toContain("User not found");
    });
  });

  describe("Backward Compatibility", () => {
    it("should migrate old single API password to new format", async () => {
      // Create user data in old format
      const oldUserData = [
        {
          id: "test-id",
          username: "olduser",
          passwordHash: "hash",
          salt: "salt",
          apiPasswordHash: "api-hash",
          apiPasswordSalt: "api-salt",
          role: "publish",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      await fs.writeFile(
        join(testDir, "users.json"),
        JSON.stringify(oldUserData, null, 2),
      );

      // Reinitialize service to load the old data
      userService.destroy();
      userService = createUserService({
        configDir: testDir,
        logger: {
          info: () => {},
          error: () => {},
          warn: () => {},
          debug: () => {},
        } as any,
      });
      await userService.initialize();

      // List API passwords should show migrated password
      const result = await userService.listApiPasswords("olduser");
      expect(result).toBeDefined();
      expect(result!.apiPasswords).toHaveLength(1);
      expect(result!.apiPasswords[0].label).toBe("default");
    });

    it("should validate password using old format", async () => {
      // Create a user (which creates new format)
      const createResult = await userService.createUser({
        username: "testuser",
        password: "Test123!@#",
        role: "publish",
      });

      // Manually set to simulate old format
      const userData = await fs.readFile(join(testDir, "users.json"), "utf-8");
      const users = JSON.parse(userData);

      // Remove new format, keep only old format
      delete users[0].apiPasswords;

      await fs.writeFile(
        join(testDir, "users.json"),
        JSON.stringify(users, null, 2),
      );

      // Reinitialize
      userService.destroy();
      userService = createUserService({
        configDir: testDir,
        logger: {
          info: () => {},
          error: () => {},
          warn: () => {},
          debug: () => {},
        } as any,
      });
      await userService.initialize();

      // Should still be able to validate with the API password
      const user = await userService.validateApiPassword(
        "testuser",
        createResult.apiPassword,
      );
      expect(user).toBeDefined();
      expect(user!.username).toBe("testuser");
    });
  });
});
