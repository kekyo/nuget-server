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
import { TypedMessage, useTypedMessage } from "typed-message";
import { messages } from "../../generated/messages";

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
  const getMessage = useTypedMessage();
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
      setValidationError(
        getMessage(messages.CURRENT_PASSWORD) + " is required",
      );
      return false;
    }

    if (!newPassword) {
      setValidationError(getMessage(messages.NEW_PASSWORD) + " is required");
      return false;
    }

    if (newPassword.length < 4) {
      setValidationError(getMessage(messages.VALIDATION_PASSWORD_TOO_SHORT));
      return false;
    }

    if (newPassword !== confirmPassword) {
      setValidationError(getMessage(messages.VALIDATION_PASSWORDS_DONT_MATCH));
      return false;
    }

    if (currentPassword === newPassword) {
      setValidationError(getMessage(messages.PASSWORD_MUST_BE_DIFFERENT));
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

      const response = await apiFetch("api/ui/password", {
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
          message:
            data.message || getMessage(messages.PASSWORD_CHANGED_SUCCESS),
        });

        // Auto-close drawer after success
        setTimeout(() => {
          handleClose();
        }, 2000);
      } else {
        setResult({
          success: false,
          message: data.error || getMessage(messages.PASSWORD_CHANGE_FAILED),
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
        message: getMessage(messages.NETWORK_ERROR_TRY_AGAIN),
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
          <TypedMessage message={messages.CHANGE_PASSWORD} />
        </Typography>
        <IconButton onClick={handleClose} disabled={loading}>
          <CloseIcon />
        </IconButton>
      </Box>

      {!result && (
        <>
          <Alert severity="info" sx={{ mb: 3 }}>
            <TypedMessage message={messages.CHANGE_PASSWORD_INSTRUCTION} />
          </Alert>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              label={getMessage(messages.CURRENT_PASSWORD)}
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
              label={getMessage(messages.NEW_PASSWORD)}
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={loading}
              required
              fullWidth
              helperText={
                newPassword
                  ? undefined
                  : getMessage(messages.PASSWORD_MIN_LENGTH)
              }
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
              label={getMessage(messages.CONFIRM_PASSWORD)}
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
              {loading
                ? getMessage(messages.CHANGING_PASSWORD)
                : getMessage(messages.CHANGE_PASSWORD)}
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
