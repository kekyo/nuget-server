// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Drawer,
  TextField,
  Typography,
} from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import { useTypedMessage } from 'typed-message';
import { messages } from '../../generated/messages';
import { apiFetch } from '../utils/apiClient';

interface TotpDrawerProps {
  onClose: () => void;
}

const TotpDrawer = ({ onClose }: TotpDrawerProps) => {
  const getMessage = useTypedMessage();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ uri: string; secret: string } | null>(
    null
  );
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const initialize = async () => {
      try {
        const response = await apiFetch('api/ui/totp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status' }),
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Status request failed');
        const result = await response.json();
        if (!controller.signal.aborted) setEnabled(result.enabled);
      } catch {
        if (!controller.signal.aborted)
          setError(getMessage(messages.TOTP_REQUEST_FAILED));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void initialize();
    return () => controller.abort();
  }, [getMessage]);

  const submit = async (action: 'setup' | 'confirm' | 'cancel') => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('api/ui/totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action,
          ...(action === 'setup' ? { password } : {}),
          ...(action === 'confirm' ? { code } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        const errorMessage =
          result.code === 'TOTP_RATE_LIMITED'
            ? messages.TOTP_RATE_LIMITED
            : result.code === 'TOTP_PASSWORD_INVALID'
              ? messages.TOTP_PASSWORD_INVALID
              : result.code === 'TOTP_EXPIRED'
                ? messages.TOTP_EXPIRED
                : result.code === 'TOTP_INVALID'
                  ? messages.TOTP_INVALID
                  : messages.TOTP_REQUEST_FAILED;
        setError(getMessage(errorMessage));
        if (result.code === 'TOTP_EXPIRED') {
          setSetup(null);
          setCode('');
        }
        return;
      }
      if (action === 'setup') {
        setSetup(result);
        setPassword('');
      }
      if (action === 'confirm') {
        setSetup(null);
        setCode('');
        setEnabled(true);
        setRecoveryCodes(result.recoveryCodes);
      }
      if (action === 'cancel') {
        setSetup(null);
        setPassword('');
        setCode('');
        onClose();
      }
    } catch {
      setError(getMessage(messages.NETWORK_ERROR_TRY_AGAIN));
    } finally {
      setLoading(false);
    }
  };

  const close = async () => {
    if (loading) return;
    if (setup) await submit('cancel');
    else onClose();
  };

  return (
    <Drawer
      open
      anchor="right"
      onClose={close}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 480 } } } }}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="h6">{getMessage(messages.TOTP_TITLE)}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {loading && (
          <CircularProgress aria-label={getMessage(messages.LOADING)} />
        )}
        {recoveryCodes.length > 0 ? (
          <>
            <Alert severity="success">
              {getMessage(messages.TOTP_ENABLED)}
            </Alert>
            <Typography>{getMessage(messages.TOTP_SAVE_RECOVERY)}</Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 2,
                overflowX: 'auto',
                userSelect: 'all',
                bgcolor: 'action.hover',
              }}
            >
              {recoveryCodes.join('\n')}
            </Box>
          </>
        ) : setup ? (
          <Box
            component="form"
            onSubmit={async (event) => {
              event.preventDefault();
              await submit('confirm');
            }}
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <Typography>{getMessage(messages.TOTP_SCAN)}</Typography>
            <Box sx={{ alignSelf: 'center', bgcolor: '#fff', p: 1 }}>
              <QRCodeSVG
                value={setup.uri}
                size={240}
                marginSize={4}
                level="M"
                bgColor="#ffffff"
                fgColor="#000000"
                title={getMessage(messages.TOTP_QR)}
              />
            </Box>
            <TextField
              label={getMessage(messages.TOTP_MANUAL_KEY)}
              value={setup.secret}
              slotProps={{ input: { readOnly: true } }}
            />
            <TextField
              autoFocus
              required
              label={getMessage(messages.TOTP_CODE)}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              slotProps={{
                htmlInput: {
                  inputMode: 'numeric',
                  pattern: '[0-9]{6}',
                  maxLength: 6,
                },
              }}
            />
            <Button type="submit" variant="contained" disabled={loading}>
              {getMessage(messages.TOTP_CONFIRM)}
            </Button>
          </Box>
        ) : enabled ? (
          <Alert severity="success">{getMessage(messages.TOTP_ENABLED)}</Alert>
        ) : (
          <Box
            component="form"
            onSubmit={async (event) => {
              event.preventDefault();
              await submit('setup');
            }}
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <Typography>{getMessage(messages.TOTP_DESCRIPTION)}</Typography>
            <TextField
              required
              type="password"
              label={getMessage(messages.PASSWORD)}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" variant="contained" disabled={loading}>
              {getMessage(messages.TOTP_SETUP)}
            </Button>
          </Box>
        )}
        <Button onClick={close} disabled={loading}>
          {getMessage(messages.CLOSE)}
        </Button>
      </Box>
    </Drawer>
  );
};

export default TotpDrawer;
