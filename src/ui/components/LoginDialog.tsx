// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState } from "react";
import { TypedMessage, useTypedMessage } from "typed-message";
import { messages } from "../../generated/messages";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  FormControlLabel,
  Checkbox,
  CircularProgress,
  useTheme,
  useMediaQuery,
  IconButton,
} from "@mui/material";
import { Login as LoginIcon, Close as CloseIcon } from "@mui/icons-material";
import { apiFetch } from "../utils/apiClient";

interface LoginResponse {
  success: boolean;
  message: string;
  user?: {
    username: string;
    role: string;
  };
}

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
  onLoginSuccess: () => void;
  realm: string;
  disableBackdropClick?: boolean; // For authMode='full'
}

const LoginDialog = ({
  open,
  onClose,
  onLoginSuccess,
  realm,
  disableBackdropClick = false,
}: LoginDialogProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const getMessage = useTypedMessage();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!username.trim() || !password.trim()) {
      setError(getMessage(messages.USERNAME_PASSWORD_REQUIRED));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch("api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
          rememberMe,
        }),
        credentials: "same-origin",
      });

      const data: LoginResponse = await response.json();

      if (data.success) {
        // Login successful, call success callback
        onLoginSuccess();
        // Clear form
        setUsername("");
        setPassword("");
        setRememberMe(false);
        setError(null);
      } else {
        setError(data.message || getMessage(messages.LOGIN_FAILED));
      }
    } catch (err) {
      setError(getMessage(messages.NETWORK_ERROR_TRY_AGAIN));
      console.error("Login error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (disableBackdropClick) {
      return; // Prevent closing for authMode='full'
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      disableEscapeKeyDown={disableBackdropClick}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          p: isMobile ? 1 : 2,
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <LoginIcon
            sx={{
              fontSize: 32,
              color: theme.palette.primary.main,
              mr: 1,
            }}
          />
          <Typography variant="h5" component="div" sx={{ fontWeight: "bold" }}>
            {realm || getMessage(messages.NUGET_SERVER)}
          </Typography>
        </Box>
        {!disableBackdropClick && (
          <IconButton
            edge="end"
            color="inherit"
            onClick={onClose}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
        )}
      </DialogTitle>

      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          <TypedMessage message={messages.PLEASE_SIGN_IN} />
        </Typography>

        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <TextField
            required
            fullWidth
            id="username"
            label={getMessage(messages.USERNAME)}
            name="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isLoading}
            variant="outlined"
          />

          <TextField
            required
            fullWidth
            name="password"
            label={getMessage(messages.PASSWORD)}
            type="password"
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            variant="outlined"
          />

          <FormControlLabel
            control={
              <Checkbox
                value={rememberMe}
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                color="primary"
                disabled={isLoading}
              />
            }
            label={getMessage(messages.REMEMBER_ME_DAYS)}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={isLoading}
            sx={{
              mt: 1,
              mb: 2,
              height: 48,
              fontSize: "1.1rem",
            }}
            startIcon={
              isLoading ? <CircularProgress size={20} /> : <LoginIcon />
            }
          >
            {isLoading
              ? getMessage(messages.SIGNING_IN)
              : getMessage(messages.SIGN_IN)}
          </Button>
        </Box>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 2, textAlign: "center" }}
        >
          <TypedMessage message={messages.NEED_HELP_CONTACT} />
        </Typography>
      </DialogContent>
    </Dialog>
  );
};

export default LoginDialog;
