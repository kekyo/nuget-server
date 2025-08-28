// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState, useEffect } from "react";
import { LinearProgress, Box, Typography, Skeleton } from "@mui/material";
import {
  checkPasswordStrength,
  PasswordStrengthResult,
} from "../../utils/passwordStrength";

interface PasswordStrengthIndicatorProps {
  password: string;
  username?: string;
}

export const PasswordStrengthIndicator = ({
  password,
  username,
}: PasswordStrengthIndicatorProps) => {
  const [strength, setStrength] = useState<PasswordStrengthResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!password) {
      setStrength(null);
      return;
    }

    setLoading(true);
    const checkStrength = () => {
      try {
        const result = checkPasswordStrength(
          password,
          username ? [username] : [],
        );
        setStrength(result);
      } catch (error) {
        console.error("Failed to check password strength:", error);
      } finally {
        setLoading(false);
      }
    };

    // Debounce password strength check
    const timer = setTimeout(checkStrength, 300);
    return () => clearTimeout(timer);
  }, [password, username]);

  if (!password) return null;

  if (loading || !strength) {
    return (
      <Box sx={{ mt: 1 }}>
        <Skeleton variant="rectangular" height={6} />
        <Skeleton variant="text" width="60%" sx={{ mt: 0.5 }} />
      </Box>
    );
  }

  const colors = ["#f44336", "#ff9800", "#ffc107", "#8bc34a", "#4caf50"];
  const color = colors[strength.score];

  return (
    <Box sx={{ mt: 1 }}>
      <LinearProgress
        variant="determinate"
        value={(strength.score + 1) * 20}
        sx={{
          height: 6,
          borderRadius: 3,
          backgroundColor: "#e0e0e0",
          "& .MuiLinearProgress-bar": { backgroundColor: color },
        }}
      />
      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
        <Typography variant="caption" sx={{ color }}>
          {strength.strength}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Time to crack: {strength.crackTime}
        </Typography>
      </Box>
      {strength.feedback.warning && (
        <Typography variant="caption" color="warning.main" display="block">
          {strength.feedback.warning}
        </Typography>
      )}
      {strength.feedback.suggestions.length > 0 && (
        <Typography variant="caption" color="text.secondary" display="block">
          Suggestion: {strength.feedback.suggestions[0]}
        </Typography>
      )}
    </Box>
  );
};
