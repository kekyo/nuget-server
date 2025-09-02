// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect } from 'vitest';
import {
  checkPasswordStrength,
  getMinPasswordScore,
} from '../src/utils/passwordStrength';

describe('Password Strength', () => {
  describe('checkPasswordStrength', () => {
    it('should detect weak passwords', () => {
      const result = checkPasswordStrength('1234');
      expect(result.score).toBe(0);
      expect(result.strength).toBe('Weak');
      expect(result.feedback.suggestions.length).toBeGreaterThan(0);
    });

    it('should detect common passwords as weak', () => {
      const result = checkPasswordStrength('password');
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.strength).toBe('Weak' || result.strength === 'Fair');
    });

    it('should detect fair passwords', () => {
      const result = checkPasswordStrength('test1234');
      expect(result.score).toBeGreaterThanOrEqual(1);
      expect(result.score).toBeLessThanOrEqual(2);
    });

    it('should detect good passwords', () => {
      const result = checkPasswordStrength('Test123!@#');
      expect(result.score).toBeGreaterThanOrEqual(2);
    });

    it('should detect strong passwords', () => {
      const result = checkPasswordStrength('MyStr0ng!P@ssw0rd#2024');
      expect(result.score).toBeGreaterThanOrEqual(3);
      expect(['Strong', 'Very Strong']).toContain(result.strength);
    });

    it('should detect very strong passwords', () => {
      const result = checkPasswordStrength(
        'Th1s!Is@Really#Complex$Password%2024^With&Many*Characters'
      );
      expect(result.score).toBe(4);
      expect(result.strength).toBe('Very Strong');
    });

    it('should penalize passwords containing username', () => {
      // Use a stronger base password so that username inclusion has a detectable impact
      const password = 'JohnDoeIsAwesome123';
      const withUsername = checkPasswordStrength(password, ['johndoe']);
      const withoutUsername = checkPasswordStrength(password);
      expect(withUsername.score).toBeLessThan(withoutUsername.score);
    });

    it('should provide crack time information', () => {
      const result = checkPasswordStrength('Test123!');
      expect(result.crackTime).toBeDefined();
      expect(typeof result.crackTime).toBe('string');
    });

    it('should provide feedback suggestions for weak passwords', () => {
      const result = checkPasswordStrength('test');
      expect(result.feedback.suggestions).toBeDefined();
      expect(Array.isArray(result.feedback.suggestions)).toBe(true);
    });

    it('should handle empty passwords', () => {
      const result = checkPasswordStrength('');
      expect(result.score).toBe(0);
      expect(result.strength).toBe('Weak');
    });

    it('should handle passwords with special characters', () => {
      const result = checkPasswordStrength('Test@#$%^&*()_+{}[]|:;<>?,./-=');
      expect(result.score).toBeGreaterThanOrEqual(2);
    });

    it('should handle unicode characters', () => {
      const result = checkPasswordStrength('Test123!こんにちは');
      expect(result.score).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getMinPasswordScore', () => {
    it('should return default score when no config provided', () => {
      const score = getMinPasswordScore();
      expect(score).toBe(2);
    });

    it('should return default score when config has no passwordMinScore', () => {
      const score = getMinPasswordScore({});
      expect(score).toBe(2);
    });

    it('should return configured score', () => {
      const score = getMinPasswordScore({ passwordMinScore: 3 });
      expect(score).toBe(3);
    });

    it('should handle score of 0', () => {
      const score = getMinPasswordScore({ passwordMinScore: 0 });
      expect(score).toBe(0);
    });

    it('should handle score of 4', () => {
      const score = getMinPasswordScore({ passwordMinScore: 4 });
      expect(score).toBe(4);
    });
  });
});
