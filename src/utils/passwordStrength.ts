// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import zxcvbn from 'zxcvbn';

export interface PasswordStrengthResult {
  score: number; // 0-4
  strength: 'Weak' | 'Fair' | 'Good' | 'Strong' | 'Very Strong';
  feedback: {
    warning?: string;
    suggestions: string[];
  };
  crackTime: string;
}

export const checkPasswordStrength = (
  password: string, 
  userInputs?: string[]
): PasswordStrengthResult => {
  const result = zxcvbn(password, userInputs);
  
  const strengthLabels: Array<'Weak' | 'Fair' | 'Good' | 'Strong' | 'Very Strong'> = 
    ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  
  return {
    score: result.score,
    strength: strengthLabels[result.score],
    feedback: {
      warning: result.feedback.warning,
      suggestions: result.feedback.suggestions
    },
    crackTime: String(result.crack_times_display.offline_slow_hashing_1e4_per_second)
  };
};

export const getMinPasswordScore = (config?: { passwordMinScore?: number }): number => {
  return config?.passwordMinScore ?? 2; // Default: Good or better
};