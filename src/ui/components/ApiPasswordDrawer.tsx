// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState, useEffect } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Close as CloseIcon,
  VpnKey as VpnKeyIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { buildAddSourceCommand } from '../utils/commandBuilder';
import { apiFetch } from '../utils/apiClient';
import { TypedMessage, useTypedMessage } from 'typed-message';
import { useSnackbar } from 'notistack';
import { messages } from '../../generated/messages';

interface ApiPasswordDrawerProps {
  open: boolean;
  onClose: () => void;
  serverConfig: any;
}

interface ApiPassword {
  label: string;
  createdAt: string;
}

interface ApiPasswordListResponse {
  apiPasswords: ApiPassword[];
}

interface ApiPasswordAddResponse {
  label: string;
  apiPassword: string;
  createdAt: string;
}

const ApiPasswordDrawer = ({
  open,
  onClose,
  serverConfig,
}: ApiPasswordDrawerProps) => {
  const getMessage = useTypedMessage();
  const { enqueueSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [apiPasswords, setApiPasswords] = useState<ApiPassword[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newApiPassword, setNewApiPassword] =
    useState<ApiPasswordAddResponse | null>(null);
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string>('');

  // Load API passwords when drawer opens
  useEffect(() => {
    if (open) {
      loadApiPasswords();
      // Get current username from serverConfig
      if (serverConfig?.currentUser?.username) {
        setCurrentUsername(serverConfig.currentUser.username);
      }
    } else {
      // Reset state when closing
      setNewApiPassword(null);
      setError(null);
      setNewLabel('');
      setDeleteConfirmDialog(null);
    }
  }, [open, serverConfig]);

  const loadApiPasswords = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch('api/ui/apipasswords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'list' }),
        credentials: 'same-origin',
      });

      if (response.ok) {
        const data: ApiPasswordListResponse = await response.json();
        setApiPasswords(data.apiPasswords);
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(
          errorData.error || getMessage(messages.FAILED_TO_LOAD_API_PASSWORDS)
        );
      }
    } catch (err) {
      setError(
        `${getMessage(messages.ERROR)}: ${err instanceof Error ? err.message : getMessage(messages.UNKNOWN_ERROR)}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAddApiPassword = async () => {
    if (!newLabel.trim()) {
      setError(getMessage(messages.TABLE_LABEL) + ' cannot be empty');
      return;
    }

    // Clear previous generated API password
    setNewApiPassword(null);

    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch('api/ui/apipasswords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'add', label: newLabel.trim() }),
        credentials: 'same-origin',
      });

      if (response.ok) {
        const data: ApiPasswordAddResponse = await response.json();
        setNewApiPassword(data);
        setNewLabel('');
        // Reload the list
        await loadApiPasswords();
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(
          errorData.error || getMessage(messages.API_KEY_GENERATION_FAILED)
        );
      }
    } catch (err) {
      setError(
        `${getMessage(messages.ERROR)}: ${err instanceof Error ? err.message : getMessage(messages.UNKNOWN_ERROR)}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteApiPassword = async (label: string) => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch('api/ui/apipasswords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'delete', label }),
        credentials: 'same-origin',
      });

      if (response.ok) {
        setDeleteConfirmDialog(null);
        // Reload the list
        await loadApiPasswords();
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(
          errorData.error || getMessage(messages.FAILED_TO_DELETE_API_PASSWORD)
        );
      }
    } catch (err) {
      setError(
        `${getMessage(messages.ERROR)}: ${err instanceof Error ? err.message : getMessage(messages.UNKNOWN_ERROR)}`
      );
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      enqueueSnackbar(getMessage(messages.COPIED_TO_CLIPBOARD), {
        variant: 'success',
      });
    } catch (err) {
      // Fallback for browsers without Clipboard API support
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      // @prettier-max-ignore-deprecated
      document.execCommand('copy');
      document.body.removeChild(textArea);
      enqueueSnackbar(getMessage(messages.COPIED_TO_CLIPBOARD), {
        variant: 'success',
      });
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
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
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: 3,
            }}
          >
            <Typography variant="h6" component="h2">
              <TypedMessage message={messages.API_PASSWORD_MANAGEMENT} />
            </Typography>
            <IconButton onClick={onClose} edge="end">
              <CloseIcon />
            </IconButton>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {error && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              onClose={() => setError(null)}
            >
              {error}
            </Alert>
          )}

          {newApiPassword && (
            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                <TypedMessage message={messages.NEW_API_PASSWORD_CREATED} />
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <TypedMessage message={messages.LABEL_PREFIX} />
                {newApiPassword.label}
              </Typography>
              <Paper
                sx={{
                  p: 2,
                  mt: 2,
                  bgcolor: (theme) =>
                    theme.palette.mode === 'dark' ? 'grey.800' : 'grey.100',
                  border: '2px dashed',
                  borderColor: 'primary.main',
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: (theme) =>
                      theme.palette.mode === 'dark' ? 'grey.700' : 'grey.200',
                  },
                }}
                onClick={() => copyToClipboard(newApiPassword.apiPassword)}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.9rem',
                    wordBreak: 'break-all',
                    mb: 1,
                  }}
                >
                  {newApiPassword.apiPassword}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  <TypedMessage message={messages.CLICK_COPY_SHOWN_ONCE} />
                </Typography>
              </Paper>

              {serverConfig.authMode === 'full' && currentUsername && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    <TypedMessage message={messages.EXAMPLE_COMMANDS} />
                  </Typography>
                  <Paper
                    sx={{
                      p: 1,
                      mt: 1,
                      bgcolor: 'grey.900',
                      color: 'grey.100',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                    }}
                    onClick={() =>
                      copyToClipboard(
                        buildAddSourceCommand({
                          serverUrl: serverConfig.serverUrl,
                          username: currentUsername,
                          apiPassword: newApiPassword.apiPassword,
                        })
                      )
                    }
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        wordBreak: 'break-all',
                      }}
                    >
                      {buildAddSourceCommand({
                        serverUrl: serverConfig.serverUrl,
                        username: currentUsername,
                        apiPassword: newApiPassword.apiPassword,
                      })}
                    </Typography>
                  </Paper>
                </Box>
              )}
            </Alert>
          )}

          {/* Inline input field for adding new API password OR max limit warning */}
          {apiPasswords.length < 10 ? (
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <Box sx={{ flex: 1 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label={getMessage(messages.TABLE_LABEL)}
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    disabled={loading}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newLabel.trim() && !loading) {
                        e.preventDefault();
                        handleAddApiPassword();
                      }
                    }}
                  />
                </Box>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleAddApiPassword}
                  disabled={loading || !newLabel.trim()}
                  startIcon={
                    loading ? <CircularProgress size={20} /> : <VpnKeyIcon />
                  }
                  sx={{ mt: '4px' }}
                >
                  <TypedMessage message={messages.GENERATE} />
                </Button>
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.5 }}
              >
                {getMessage(messages.API_PASSWORD_LABEL_HELPER)}
              </Typography>
            </Box>
          ) : (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <TypedMessage message={messages.MAX_API_PASSWORDS} />
            </Alert>
          )}

          {/* API passwords count display */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            <TypedMessage
              message={messages.API_PASSWORDS_COUNT}
              params={{ current: apiPasswords.length }}
            />
          </Typography>

          {loading && !apiPasswords.length ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : apiPasswords.length === 0 ? (
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">
                <TypedMessage message={messages.NO_API_PASSWORDS} />
              </Typography>
            </Paper>
          ) : (
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <TypedMessage message={messages.TABLE_LABEL} />
                    </TableCell>
                    <TableCell>
                      <TypedMessage message={messages.TABLE_CREATED} />
                    </TableCell>
                    <TableCell align="right">
                      <TypedMessage message={messages.TABLE_DELETE} />
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {apiPasswords.map((apiPwd) => (
                    <TableRow key={apiPwd.label}>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {apiPwd.label}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {formatDate(apiPwd.createdAt)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            setNewApiPassword(null);
                            setDeleteConfirmDialog(apiPwd.label);
                          }}
                          disabled={loading}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      </Drawer>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteConfirmDialog}
        onClose={() => !loading && setDeleteConfirmDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <TypedMessage message={messages.DELETE_API_PASSWORD_TITLE} />
        </DialogTitle>
        <DialogContent>
          <Typography>
            <TypedMessage
              message={messages.CONFIRM_DELETE_API_PASSWORD}
              params={{ label: deleteConfirmDialog || '' }}
            />
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            <TypedMessage message={messages.API_PASSWORD_DELETE_WARNING} />
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteConfirmDialog(null)}
            disabled={loading}
          >
            <TypedMessage message={messages.CANCEL} />
          </Button>
          <Button
            onClick={() =>
              deleteConfirmDialog &&
              handleDeleteApiPassword(deleteConfirmDialog)
            }
            variant="contained"
            color="error"
            disabled={loading}
            startIcon={
              loading ? <CircularProgress size={20} /> : <DeleteIcon />
            }
          >
            <TypedMessage message={messages.DELETE} />
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ApiPasswordDrawer;
