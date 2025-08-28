// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

// Dynamic import type for zxcvbn
type ZxcvbnFunction = typeof import("zxcvbn");

// Cache for the loaded zxcvbn module
let zxcvbnCache: ZxcvbnFunction | null = null;

export interface PasswordStrengthResult {
  score: number; // 0-4
  strength: "Weak" | "Fair" | "Good" | "Strong" | "Very Strong";
  feedback: {
    warning?: string;
    suggestions: string[];
  };
  crackTime: string;
}

/**
 * Dynamically load zxcvbn library
 */
const loadZxcvbn = async (): Promise<ZxcvbnFunction> => {
  if (!zxcvbnCache) {
    const module = await import(
      /* webpackChunkName: "password-checker" */
      "zxcvbn"
    );
    // Handle both default export and module export
    zxcvbnCache = (module as any).default || module;
  }
  return zxcvbnCache!;
};

/**
 * Check password strength asynchronously
 */
export const checkPasswordStrength = async (
  password: string,
  userInputs?: string[],
): Promise<PasswordStrengthResult> => {
  const zxcvbn = await loadZxcvbn();
  const result = zxcvbn(password, userInputs);

  const strengthLabels: Array<
    "Weak" | "Fair" | "Good" | "Strong" | "Very Strong"
  > = ["Weak", "Fair", "Good", "Strong", "Very Strong"];

  return {
    score: result.score,
    strength: strengthLabels[result.score],
    feedback: {
      warning: result.feedback.warning,
      suggestions: result.feedback.suggestions,
    },
    crackTime: String(
      result.crack_times_display.offline_slow_hashing_1e4_per_second,
    ),
  };
};

export const getMinPasswordScore = (config?: {
  passwordMinScore?: number;
}): number => {
  return config?.passwordMinScore ?? 2; // Default: Good or better
};
