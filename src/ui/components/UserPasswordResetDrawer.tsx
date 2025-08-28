// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState, useEffect } from 'react';
import {
  Drawer,
  Box,
  Typography,
  Button,
  TextField,
  Alert,
  CircularProgress,
  IconButton,
  Divider,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
} from '@mui/material';
import {
  Close as CloseIcon,
  LockReset as LockResetIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { PasswordStrengthIndicator } from './PasswordStrengthIndicator';

interface UserPasswordResetDrawerProps {
  open: boolean;
  onClose: () => void;
  onPasswordResetSuccess?: () => void;
}

interface User {
  id: string;
  username: string;
  role: string;
}

interface ResetResult {
  success: boolean;
  message: string;
}

const UserPasswordResetDrawer = ({ 
  open, 
  onClose, 
  onPasswordResetSuccess 
}: UserPasswordResetDrawerProps) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<ResetResult | null>(null);

  // Load users when drawer opens
  useEffect(() => {
    if (open) {
      loadUsers();
    }
  }, [open]);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await fetch('/api/ui/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'list' })
      });

      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      } else if (response.status === 401) {
        // Authentication required
        window.location.reload();
      } else {
        setResult({
          success: false,
          message: `Failed to load users: ${response.statusText}`
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: `Error loading users: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleReset = async () => {
    // Validate inputs
    if (!selectedUsername) {
      setResult({
        success: false,
        message: 'Please select a user'
      });
      return;
    }

    if (!password || !confirmPassword) {
      setResult({
        success: false,
        message: 'Both password fields are required'
      });
      return;
    }

    if (password !== confirmPassword) {
      setResult({
        success: false,
        message: 'Passwords do not match'
      });
      return;
    }

    if (password.length < 4) {
      setResult({
        success: false,
        message: 'Password must be at least 4 characters long'
      });
      return;
    }

    setResetting(true);
    setResult(null);

    try {
      const response = await fetch('/api/ui/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'update',
          username: selectedUsername,
          password
        })
      });

      const data = await response.json();

      if (response.ok) {
        setResult({
          success: true,
          message: data.message || 'Password reset successfully'
        });
        if (onPasswordResetSuccess) {
          onPasswordResetSuccess();
        }
      } else if (response.status === 401) {
        // Authentication required
        window.location.reload();
        return;
      } else {
        setResult({
          success: false,
          message: data.error || data.message || `Reset failed: ${response.status} ${response.statusText}`,
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: `Reset error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setResetting(false);
    }
  };

  const handleClose = () => {
    setSelectedUsername(null);
    setPassword('');
    setConfirmPassword('');
    setResetting(false);
    setResult(null);
    setUsers([]);
    onClose();
  };

  const resetForm = () => {
    setSelectedUsername(null);
    setPassword('');
    setConfirmPassword('');
    setResult(null);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      variant="temporary"
      sx={{
        width: 400,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: 400,
          boxSizing: 'border-box',
        },
      }}
    >
      <Box sx={{ p: 3, height: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h6" component="h2">
            Reset User Password
          </Typography>
          <IconButton onClick={handleClose} edge="end">
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ mb: 3 }} />

        {!result ? (
          <Box>
            <Typography variant="body1" sx={{ mb: 3 }}>
              Reset password for an existing user:
            </Typography>

            {loadingUsers ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                <Autocomplete
                  options={users}
                  getOptionLabel={(option) => `${option.username} (${option.role})`}
                  value={users.find(u => u.username === selectedUsername) || null}
                  onChange={(event, newValue) => {
                    setSelectedUsername(newValue ? newValue.username : null);
                  }}
                  disabled={resetting}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Select User"
                      variant="outlined"
                      fullWidth
                    />
                  )}
                  sx={{ mb: 3 }}
                />

                <TextField
                  fullWidth
                  label="New Password"
                  type="password"
                  variant="outlined"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={resetting}
                  sx={{ mb: 1 }}
                  helperText="Minimum 4 characters"
                />
                <PasswordStrengthIndicator password={password} username={selectedUsername || undefined} />

                <TextField
                  fullWidth
                  label="Confirm New Password"
                  type="password"
                  variant="outlined"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={resetting}
                  sx={{ mb: 3, mt: 2 }}
                />

                <Alert severity="warning" sx={{ mb: 3 }}>
                  <Typography variant="body2">
                    The user will need to use this new password to authenticate.
                    Make sure to communicate the new password securely.
                  </Typography>
                </Alert>

                <Button
                  variant="contained"
                  fullWidth
                  startIcon={resetting ? <CircularProgress size={20} /> : <LockResetIcon />}
                  onClick={handleReset}
                  disabled={resetting || !selectedUsername || !password || !confirmPassword}
                  sx={{ mb: 2 }}
                >
                  {resetting ? 'Resetting...' : 'Reset Password'}
                </Button>
              </>
            )}
          </Box>
        ) : (
          <Box>
            <Alert
              severity={result.success ? 'success' : 'error'}
              icon={result.success ? <SuccessIcon /> : <ErrorIcon />}
              sx={{ mb: 3 }}
            >
              {result.success ? 'Password Reset Successfully!' : 'Reset Failed'}
            </Alert>

            {result.success && selectedUsername && (
              <Paper sx={{ p: 2, mb: 3 }} variant="outlined" elevation={0}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Password reset completed
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 'medium', mb: 1 }}>
                  User: {selectedUsername}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  The password has been successfully updated.
                </Typography>
              </Paper>
            )}

            {result.message && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Details:
                </Typography>
                <Paper
                  sx={{
                    p: 1,
                    borderRadius: 1,
                  }}
                  variant="outlined"
                  elevation={0}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {result.message}
                  </Typography>
                </Paper>
              </Box>
            )}

            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                onClick={resetForm}
                sx={{ flex: 1 }}
              >
                Reset Another
              </Button>
              <Button
                variant="contained"
                onClick={handleClose}
                sx={{ flex: 1 }}
              >
                Close
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

export default UserPasswordResetDrawer;