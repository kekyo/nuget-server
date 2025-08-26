// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState } from 'react';
import {
  Drawer,
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  IconButton,
  Divider,
  Paper,
} from '@mui/material';
import {
  Close as CloseIcon,
  VpnKey as VpnKeyIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { buildAddSourceCommand, buildPublishCommand } from '../utils/commandBuilder';

interface ApiPasswordDrawerProps {
  open: boolean;
  onClose: () => void;
  serverConfig: any;
}

interface RegenerationResult {
  success: boolean;
  message: string;
  apiPassword?: string;
  username?: string;
}

const ApiPasswordDrawer = ({ open, onClose, serverConfig }: ApiPasswordDrawerProps) => {
  const [regenerating, setRegenerating] = useState(false);
  const [result, setResult] = useState<RegenerationResult | null>(null);

  const handleRegenerate = async () => {
    try {
      setRegenerating(true);
      
      const response = await fetch('/api/ui/apipassword', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        credentials: 'same-origin',
      });

      if (response.ok) {
        const data = await response.json();
        setResult({
          success: true,
          message: 'API password regenerated successfully',
          apiPassword: data.apiPassword,
          username: data.username,
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        setResult({
          success: false,
          message: errorData.error || `Failed to regenerate API password (${response.status})`,
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setRegenerating(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setRegenerating(false);
    onClose();
  };

  const resetAndRegenerate = () => {
    setResult(null);
    handleRegenerate();
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      variant="temporary"
      sx={{
        width: 500,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: 500,
          boxSizing: 'border-box',
        },
      }}
    >
      <Box sx={{ p: 3, height: '100%', overflowY: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h6" component="h2">
            Regenerate API Password
          </Typography>
          <IconButton onClick={handleClose} edge="end">
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ mb: 3 }} />

        {!result ? (
          <Box>
            <Alert severity="warning" sx={{ mb: 3 }}>
              <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                Warning: This will invalidate your current API password
              </Typography>
              <Typography variant="body2">
                Regenerating your API password will invalidate the current one. 
                Any applications or scripts using the old password will need to be updated.
                This action cannot be undone.
              </Typography>
            </Alert>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                color="primary"
                startIcon={regenerating ? <CircularProgress size={20} /> : <VpnKeyIcon />}
                onClick={handleRegenerate}
                disabled={regenerating}
                fullWidth
              >
                {regenerating ? 'Regenerating...' : 'Regenerate API Password'}
              </Button>
            </Box>
          </Box>
        ) : (
          <Box>
            <Alert
              severity={result.success ? 'success' : 'error'}
              icon={result.success ? <SuccessIcon /> : <ErrorIcon />}
              sx={{ mb: 3 }}
            >
              {result.success ? 'API Password Regenerated Successfully!' : 'Regeneration Failed'}
            </Alert>

            {result.success && result.apiPassword && (
              <>
                <Alert severity="warning" sx={{ mb: 3 }}>
                  <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                    Important: Save your API password!
                  </Typography>
                  <Typography variant="body2">
                    This API password will only be shown once. Copy it now and store it securely.
                  </Typography>
                </Alert>

                <Paper sx={{ p: 2, mb: 3 }} variant="outlined" elevation={0}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    API Password:
                  </Typography>
                  <Paper
                    sx={{
                      p: 2,
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.100',
                      border: '2px dashed',
                      borderColor: 'primary.main',
                      cursor: 'pointer',
                      mb: 3,
                      '&:hover': {
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.200'
                      }
                    }}
                    onClick={() => copyToClipboard(result.apiPassword!)}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.9rem',
                        wordBreak: 'break-all',
                        mb: 1
                      }}
                    >
                      {result.apiPassword}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Click to copy to clipboard
                    </Typography>
                  </Paper>

                  {serverConfig.authMode === 'full' && (
                    <>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Add source using dotnet CLI:
                      </Typography>
                      <Paper
                        sx={{
                          p: 2,
                          bgcolor: 'grey.900',
                          color: 'grey.100',
                          cursor: 'pointer',
                          mb: 3,
                          '&:hover': {
                            bgcolor: 'grey.800'
                          }
                        }}
                        onClick={() => copyToClipboard(buildAddSourceCommand({
                          serverUrl: serverConfig.serverUrl,
                          username: result.username,
                          apiPassword: result.apiPassword,
                        }))}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.85rem',
                            wordBreak: 'break-all',
                            mb: 1
                          }}
                        >
                          {buildAddSourceCommand({
                            serverUrl: serverConfig.serverUrl,
                            username: result.username,
                            apiPassword: result.apiPassword,
                          })}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'grey.400' }}>
                          Click to copy to clipboard
                        </Typography>
                      </Paper>
                    </>
                  )}

                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Publish packages using curl:
                  </Typography>
                  <Paper
                    sx={{
                      p: 2,
                      bgcolor: 'grey.900',
                      color: 'grey.100',
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor: 'grey.800'
                      }
                    }}
                    onClick={() => copyToClipboard(buildPublishCommand({
                      serverUrl: serverConfig.serverUrl,
                      username: result.username,
                      apiPassword: result.apiPassword,
                    }))}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                        whiteSpace: 'pre',
                        overflowX: 'auto',
                        mb: 1
                      }}
                    >
                      {buildPublishCommand({
                        serverUrl: serverConfig.serverUrl,
                        username: result.username,
                        apiPassword: result.apiPassword,
                      })}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'grey.400' }}>
                      Click to copy to clipboard
                    </Typography>
                  </Paper>
                </Paper>
              </>
            )}

            {!result.success && result.message && (
              <Paper
                sx={{
                  p: 2,
                  mb: 3,
                  bgcolor: 'error.light',
                  color: 'error.contrastText'
                }}
                variant="outlined"
                elevation={0}
              >
                <Typography variant="body2">
                  {result.message}
                </Typography>
              </Paper>
            )}

            <Box sx={{ display: 'flex', gap: 2 }}>
              {result.success ? (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleClose}
                  fullWidth
                >
                  Close
                </Button>
              ) : (
                <>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={resetAndRegenerate}
                    fullWidth
                  >
                    Try Again
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={handleClose}
                    fullWidth
                  >
                    Cancel
                  </Button>
                </>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

export default ApiPasswordDrawer;