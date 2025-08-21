// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState } from 'react';
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
} from '@mui/material';
import {
  Close as CloseIcon,
  PersonAdd as PersonAddIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';

interface UserRegistrationDrawerProps {
  open: boolean;
  onClose: () => void;
  onRegistrationSuccess: () => void;
}

interface RegistrationResult {
  success: boolean;
  username?: string;
  role?: string;
  message?: string;
}

type UserRole = 'readonly' | 'read-publish' | 'admin';

const UserRegistrationDrawer = ({ open, onClose, onRegistrationSuccess }: UserRegistrationDrawerProps) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole>('readonly');
  const [registering, setRegistering] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);

  const handleRegister = async () => {
    // Validate inputs
    if (!username.trim() || !password || !confirmPassword) {
      setResult({
        success: false,
        message: 'All fields are required'
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

    if (!/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
      setResult({
        success: false,
        message: 'Username must contain only alphanumeric characters, hyphens, and underscores'
      });
      return;
    }

    setRegistering(true);
    setResult(null);

    try {
      const response = await fetch('/api/useradd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          username: username.trim(),
          password,
          role
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setResult({
          success: true,
          username: result.username,
          role: result.role,
          message: result.message,
        });
        onRegistrationSuccess();
      } else if (response.status === 401) {
        // Authentication required - reload to trigger browser's Basic auth popup
        window.location.reload();
        return;
      } else {
        const errorData = await response.json();
        setResult({
          success: false,
          message: errorData.error || `Registration failed: ${response.status} ${response.statusText}`,
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: `Registration error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setRegistering(false);
    }
  };

  const handleClose = () => {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setRole('readonly');
    setRegistering(false);
    setResult(null);
    onClose();
  };

  const resetForm = () => {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setRole('readonly');
    setResult(null);
  };

  const getRoleDescription = (role: UserRole): string => {
    switch (role) {
      case 'readonly':
        return 'Can view and download packages';
      case 'read-publish':
        return 'Can view, download, and upload packages';
      case 'admin':
        return 'Can view, download, upload packages, and manage users';
      default:
        return '';
    }
  };

  const getRoleDisplayName = (role: UserRole): string => {
    switch (role) {
      case 'readonly':
        return 'Read Only';
      case 'read-publish':
        return 'Read & Publish';
      case 'admin':
        return 'Administrator';
      default:
        return role;
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      variant="persistent"
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
            Register User
          </Typography>
          <IconButton onClick={handleClose} edge="end">
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ mb: 3 }} />

        {!result ? (
          <Box>
            <Typography variant="body1" sx={{ mb: 3 }}>
              Add a new user to the NuGet server:
            </Typography>

            <TextField
              fullWidth
              label="Username"
              variant="outlined"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={registering}
              sx={{ mb: 2 }}
              helperText="Only alphanumeric characters, hyphens, and underscores"
            />

            <TextField
              fullWidth
              label="Password"
              type="password"
              variant="outlined"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={registering}
              sx={{ mb: 2 }}
              helperText="Minimum 4 characters"
            />

            <TextField
              fullWidth
              label="Confirm Password"
              type="password"
              variant="outlined"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={registering}
              sx={{ mb: 3 }}
            />

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Role</InputLabel>
              <Select
                value={role}
                label="Role"
                onChange={(e) => setRole(e.target.value as UserRole)}
                disabled={registering}
              >
                <MenuItem value="readonly">Read Only</MenuItem>
                <MenuItem value="read-publish">Read & Publish</MenuItem>
                <MenuItem value="admin">Administrator</MenuItem>
              </Select>
            </FormControl>

            <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }} variant="outlined" elevation={0}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                <strong>{getRoleDisplayName(role)}:</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {getRoleDescription(role)}
              </Typography>
            </Paper>

            <Button
              variant="contained"
              fullWidth
              startIcon={registering ? <CircularProgress size={20} /> : <PersonAddIcon />}
              onClick={handleRegister}
              disabled={registering || !username.trim() || !password || !confirmPassword}
              sx={{ mb: 2 }}
            >
              {registering ? 'Registering...' : 'Register User'}
            </Button>
          </Box>
        ) : (
          <Box>
            <Alert
              severity={result.success ? 'success' : 'error'}
              icon={result.success ? <SuccessIcon /> : <ErrorIcon />}
              sx={{ mb: 3 }}
            >
              {result.success ? 'User Registered Successfully!' : 'Registration Failed'}
            </Alert>

            {result.success && result.username && (
              <Paper sx={{ p: 2, mb: 3 }} variant="outlined" elevation={0}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  User Details:
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                  {result.username}
                </Typography>
                {result.role && (
                  <Typography variant="body2" color="text.secondary">
                    Role: {getRoleDisplayName(result.role as UserRole)}
                  </Typography>
                )}
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
                Register Another
              </Button>
              <Button
                variant="contained"
                onClick={handleClose}
                sx={{ flex: 1 }}
              >
                Done
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

export default UserRegistrationDrawer;