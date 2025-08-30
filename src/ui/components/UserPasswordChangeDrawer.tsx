// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState } from "react";
import {
  Drawer,
  Box,
  Typography,
  Button,
  TextField,
  Alert,
  CircularProgress,
  IconButton,
  InputAdornment,
} from "@mui/material";
import {
  Close as CloseIcon,
  Visibility,
  VisibilityOff,
  LockReset as LockResetIcon,
} from "@mui/icons-material";
import { PasswordStrengthIndicator } from "./PasswordStrengthIndicator";
import { apiFetch } from "../utils/apiClient";

interface UserPasswordChangeDrawerProps {
  open: boolean;
  onClose: () => void;
}

interface PasswordChangeResult {
  success: boolean;
  message: string;
}

const UserPasswordChangeDrawer = ({
  open,
  onClose,
}: UserPasswordChangeDrawerProps) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PasswordChangeResult | null>(null);
  const [validationError, setValidationError] = useState("");

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setResult(null);
    setValidationError("");
  };

  const handleClose = () => {
    if (!loading) {
      resetForm();
      onClose();
    }
  };

  const validateForm = (): boolean => {
    if (!currentPassword) {
      setValidationError("Current password is required");
      return false;
    }

    if (!newPassword) {
      setValidationError("New password is required");
      return false;
    }

    if (newPassword.length < 4) {
      setValidationError("New password must be at least 4 characters");
      return false;
    }

    if (newPassword !== confirmPassword) {
      setValidationError("New passwords do not match");
      return false;
    }

    if (currentPassword === newPassword) {
      setValidationError(
        "New password must be different from current password",
      );
      return false;
    }

    setValidationError("");
    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      setResult(null);

      const response = await apiFetch("/api/ui/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult({
          success: true,
          message: data.message || "Password changed successfully",
        });

        // Auto-close drawer after success
        setTimeout(() => {
          handleClose();
        }, 2000);
      } else {
        setResult({
          success: false,
          message: data.error || "Failed to change password",
        });

        // Clear password fields on error
        if (response.status === 401) {
          setCurrentPassword("");
        }
      }
    } catch (error) {
      console.error("Failed to change password:", error);
      setResult({
        success: false,
        message: "Failed to connect to server",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !loading && !validationError) {
      handleSubmit();
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      slotProps={{
        paper: {
          sx: {
            width: 500,
            p: 3,
          },
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 3,
        }}
      >
        <Typography
          variant="h5"
          sx={{ display: "flex", alignItems: "center", gap: 1 }}
        >
          <LockResetIcon />
          Change Password
        </Typography>
        <IconButton onClick={handleClose} disabled={loading}>
          <CloseIcon />
        </IconButton>
      </Box>

      {!result && (
        <>
          <Alert severity="info" sx={{ mb: 3 }}>
            Enter your current password and choose a new password.
          </Alert>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              label="Current Password"
              type={showCurrentPassword ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={loading}
              required
              fullWidth
              autoFocus
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() =>
                          setShowCurrentPassword(!showCurrentPassword)
                        }
                        edge="end"
                      >
                        {showCurrentPassword ? (
                          <VisibilityOff />
                        ) : (
                          <Visibility />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />

            <TextField
              label="New Password"
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={loading}
              required
              fullWidth
              helperText={newPassword ? undefined : "Minimum 4 characters"}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        edge="end"
                      >
                        {showNewPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            {newPassword && (
              <PasswordStrengthIndicator password={newPassword} />
            )}

            <TextField
              label="Confirm New Password"
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={loading}
              required
              fullWidth
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() =>
                          setShowConfirmPassword(!showConfirmPassword)
                        }
                        edge="end"
                      >
                        {showConfirmPassword ? (
                          <VisibilityOff />
                        ) : (
                          <Visibility />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />

            {validationError && (
              <Alert severity="error">{validationError}</Alert>
            )}

            <Button
              variant="contained"
              startIcon={
                loading ? (
                  <CircularProgress size={20} color="inherit" />
                ) : (
                  <LockResetIcon />
                )
              }
              onClick={handleSubmit}
              disabled={loading || !!validationError}
              fullWidth
              sx={{ mt: 2 }}
            >
              {loading ? "Changing Password..." : "Change Password"}
            </Button>
          </Box>
        </>
      )}

      {result && (
        <Alert severity={result.success ? "success" : "error"} sx={{ mt: 2 }}>
          {result.message}
        </Alert>
      )}
    </Drawer>
  );
};

export default UserPasswordChangeDrawer;
