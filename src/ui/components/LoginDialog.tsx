// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useEffect, useState } from 'react';
import { TypedMessage, useTypedMessage } from 'typed-message';
import { messages } from '../../generated/messages';
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
} from '@mui/material';
import { Login as LoginIcon, Close as CloseIcon } from '@mui/icons-material';
import { apiFetch, resetSessionExpiryHandling } from '../utils/apiClient';

interface LoginResponse {
  success: boolean;
  message: string;
  totpRequired?: boolean;
  code?: string;
  user?: {
    username: string;
    role: string;
  };
}

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
  onLoginSuccess: (username: string) => void;
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
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const getMessage = useTypedMessage();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [totpRequired, setTotpRequired] = useState(false);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setCode('');
      setTotpRequired(false);
      setRecovery(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (
    event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>
  ) => {
    event.preventDefault();

    if (!totpRequired && (!username.trim() || !password.trim())) {
      setError(getMessage(messages.USERNAME_PASSWORD_REQUIRED));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch(
        totpRequired ? 'api/auth/login/totp' : 'api/auth/login',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            totpRequired
              ? { code: code.trim(), recovery }
              : {
                  username: username.trim(),
                  password,
                  rememberMe,
                }
          ),
          credentials: 'same-origin',
        }
      );

      const data: LoginResponse = await response.json();

      if (data.totpRequired) {
        setTotpRequired(true);
        setPassword('');
        setCode('');
        setRecovery(false);
      } else if (data.success) {
        resetSessionExpiryHandling();
        // Login successful, call success callback with username
        const loggedInUsername = data.user?.username || username;
        onLoginSuccess(loggedInUsername);
        // Clear form
        setUsername('');
        setPassword('');
        setRememberMe(false);
        setError(null);
        setCode('');
        setTotpRequired(false);
      } else {
        setError(
          data.code === 'TOTP_RATE_LIMITED'
            ? getMessage(messages.TOTP_RATE_LIMITED)
            : data.code === 'TOTP_EXPIRED'
              ? getMessage(messages.TOTP_EXPIRED)
              : totpRequired
                ? getMessage(messages.TOTP_INVALID)
                : data.message || getMessage(messages.LOGIN_FAILED)
        );
        if (data.code === 'TOTP_EXPIRED') {
          setTotpRequired(false);
          setCode('');
        }
      }
    } catch (err) {
      setError(getMessage(messages.NETWORK_ERROR_TRY_AGAIN));
      console.error('Login error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const restartLogin = async () => {
    setIsLoading(true);
    try {
      await apiFetch('api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      setTotpRequired(false);
      setRecovery(false);
      setCode('');
      setPassword('');
      setError(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDialogClose = (
    _event: object,
    reason: 'backdropClick' | 'escapeKeyDown'
  ) => {
    if (disableBackdropClick && reason !== undefined) {
      return; // Prevent closing for authMode='full'
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 2,
            p: isMobile ? 1 : 2,
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <LoginIcon
            sx={{
              fontSize: 32,
              color: theme.palette.primary.main,
              mr: 1,
            }}
          />
          <Typography variant="h5" component="div" sx={{ fontWeight: 'bold' }}>
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
          <TypedMessage
            message={
              totpRequired
                ? messages.TOTP_LOGIN_PROMPT
                : messages.PLEASE_SIGN_IN
            }
          />
        </Typography>

        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {totpRequired ? (
            <>
              <TextField
                required
                fullWidth
                autoFocus
                key="totp-code"
                label={getMessage(
                  recovery ? messages.TOTP_RECOVERY_CODE : messages.TOTP_CODE
                )}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={isLoading}
                slotProps={{
                  htmlInput: {
                    inputMode: recovery ? 'text' : 'numeric',
                    maxLength: recovery ? 64 : 6,
                    pattern: recovery ? undefined : '[0-9]{6}',
                  },
                }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={recovery}
                    disabled={isLoading}
                    onChange={(event) => {
                      setRecovery(event.target.checked);
                      setCode('');
                    }}
                  />
                }
                label={getMessage(messages.TOTP_USE_RECOVERY)}
              />
            </>
          ) : (
            <>
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
            </>
          )}

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
              fontSize: '1.1rem',
            }}
            startIcon={
              isLoading ? <CircularProgress size={20} /> : <LoginIcon />
            }
          >
            {isLoading
              ? getMessage(messages.SIGNING_IN)
              : getMessage(messages.SIGN_IN)}
          </Button>
          {totpRequired && (
            <Button disabled={isLoading} onClick={restartLogin}>
              {getMessage(messages.TOTP_BACK)}
            </Button>
          )}
        </Box>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 2, textAlign: 'center' }}
        >
          <TypedMessage message={messages.NEED_HELP_CONTACT} />
        </Typography>
      </DialogContent>
    </Dialog>
  );
};

export default LoginDialog;
