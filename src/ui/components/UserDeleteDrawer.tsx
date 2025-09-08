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
  Autocomplete,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  Close as CloseIcon,
  PersonRemove as PersonRemoveIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { apiFetch } from '../utils/apiClient';
import { TypedMessage, useTypedMessage } from 'typed-message';
import { messages } from '../../generated/messages';

interface UserDeleteDrawerProps {
  open: boolean;
  onClose: () => void;
  onDeleteSuccess?: () => void;
  currentUsername?: string;
}

interface User {
  id: string;
  username: string;
  role: string;
}

interface DeleteResult {
  success: boolean;
  message: string;
}

const UserDeleteDrawer = ({
  open,
  onClose,
  onDeleteSuccess,
  currentUsername,
}: UserDeleteDrawerProps) => {
  const getMessage = useTypedMessage();
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<DeleteResult | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  // Load users when drawer opens
  useEffect(() => {
    if (open) {
      loadUsers();
    }
  }, [open]);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await apiFetch('api/ui/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'list' }),
      });

      if (response.ok) {
        const data = await response.json();
        // Filter out the current user to prevent self-deletion
        const filteredUsers = (data.users || []).filter(
          (user: User) => user.username !== currentUsername
        );
        setUsers(filteredUsers);
      } else if (response.status === 401) {
        // Session expired - close drawer and let AppContent handle login
        handleClose();
        return;
      } else {
        setResult({
          success: false,
          message: `Failed to load users: ${response.statusText}`,
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: `${getMessage(messages.ERROR_LOADING_USERS)}: ${error instanceof Error ? error.message : getMessage(messages.UNKNOWN_ERROR)}`,
      });
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleDeleteClick = () => {
    if (!selectedUsername) {
      setResult({
        success: false,
        message: getMessage(messages.SELECT_USER_TO_DELETE),
      });
      return;
    }
    setConfirmDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    setConfirmDialogOpen(false);

    if (!selectedUsername) {
      return;
    }

    setDeleting(true);
    setResult(null);

    try {
      const response = await apiFetch('api/ui/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'delete',
          username: selectedUsername,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult({
          success: true,
          message: data.message || getMessage(messages.USER_DELETED_SUCCESS),
        });
        if (onDeleteSuccess) {
          onDeleteSuccess();
        }
        // Reload users list
        loadUsers();
      } else if (response.status === 401) {
        // Session expired - close drawer and let AppContent handle login
        handleClose();
        return;
      } else {
        setResult({
          success: false,
          message:
            data.error ||
            data.message ||
            `Delete failed: ${response.status} ${response.statusText}`,
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: `${getMessage(messages.USER_DELETE_FAILED)}: ${error instanceof Error ? error.message : getMessage(messages.UNKNOWN_ERROR)}`,
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setConfirmDialogOpen(false);
  };

  const handleClose = () => {
    setSelectedUsername(null);
    setDeleting(false);
    setResult(null);
    setUsers([]);
    setConfirmDialogOpen(false);
    onClose();
  };

  const resetForm = () => {
    setSelectedUsername(null);
    setResult(null);
  };

  const selectedUser = users.find((u) => u.username === selectedUsername);

  return (
    <>
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
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: 3,
            }}
          >
            <Typography variant="h6" component="h2">
              <TypedMessage message={messages.DELETE_USER_TITLE} />
            </Typography>
            <IconButton onClick={handleClose} edge="end">
              <CloseIcon />
            </IconButton>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {!result ? (
            <Box>
              <Typography variant="body1" sx={{ mb: 3 }}>
                <TypedMessage
                  message={messages.SELECT_USER_DELETE_INSTRUCTION}
                />
              </Typography>

              {loadingUsers ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <>
                  {users.length === 0 ? (
                    <Alert severity="info" sx={{ mb: 3 }}>
                      <TypedMessage message={messages.NO_USERS_TO_DELETE} />
                    </Alert>
                  ) : (
                    <>
                      <Autocomplete
                        options={users}
                        getOptionLabel={(option) =>
                          `${option.username} (${option.role})`
                        }
                        value={
                          users.find((u) => u.username === selectedUsername) ||
                          null
                        }
                        onChange={(_event, newValue) => {
                          setSelectedUsername(
                            newValue ? newValue.username : null
                          );
                        }}
                        disabled={deleting}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label={getMessage(messages.SELECT_USER_TO_DELETE)}
                            variant="outlined"
                            fullWidth
                          />
                        )}
                        sx={{ mb: 3 }}
                      />

                      {selectedUser && (
                        <Paper
                          sx={{ p: 2, mb: 3, bgcolor: 'warning.dark' }}
                          variant="outlined"
                          elevation={0}
                        >
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              mb: 1,
                            }}
                          >
                            <WarningIcon
                              sx={{ mr: 1, color: 'warning.main' }}
                            />
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 'bold' }}
                            >
                              <TypedMessage message={messages.WARNING_LABEL} />
                            </Typography>
                          </Box>
                          <Typography variant="body2">
                            <TypedMessage
                              message={messages.DELETE_USER_WARNING}
                              params={{ username: selectedUser.username }}
                            />
                          </Typography>
                        </Paper>
                      )}

                      <Button
                        variant="contained"
                        fullWidth
                        color="error"
                        startIcon={
                          deleting ? (
                            <CircularProgress size={20} />
                          ) : (
                            <PersonRemoveIcon />
                          )
                        }
                        onClick={handleDeleteClick}
                        disabled={deleting || !selectedUsername}
                        sx={{ mb: 2 }}
                      >
                        {deleting
                          ? getMessage(messages.DELETING)
                          : getMessage(messages.DELETE_USER)}
                      </Button>
                    </>
                  )}
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
                {result.success
                  ? getMessage(messages.USER_DELETED_SUCCESS)
                  : getMessage(messages.USER_DELETE_FAILED)}
              </Alert>

              {result.message && (
                <Box sx={{ mb: 3 }}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    gutterBottom
                  >
                    <TypedMessage message={messages.DETAILS_LABEL} />
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
                {result.success ? (
                  <>
                    <Button
                      variant="outlined"
                      onClick={resetForm}
                      sx={{ flex: 1 }}
                    >
                      <TypedMessage message={messages.DELETE_ANOTHER} />
                    </Button>
                  </>
                ) : (
                  <Button variant="contained" onClick={handleClose} fullWidth>
                    <TypedMessage message={messages.CLOSE} />
                  </Button>
                )}
              </Box>
            </Box>
          )}
        </Box>
      </Drawer>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmDialogOpen}
        onClose={handleCancelDelete}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">
          <TypedMessage message={messages.CONFIRM_USER_DELETION_TITLE} />
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-dialog-description">
            <TypedMessage
              message={messages.CONFIRM_DELETE_MESSAGE}
              params={{ username: selectedUsername || '' }}
            />
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDelete} autoFocus>
            <TypedMessage message={messages.CANCEL} />
          </Button>
          <Button
            onClick={handleConfirmDelete}
            color="error"
            variant="contained"
          >
            <TypedMessage message={messages.DELETE} />
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default UserDeleteDrawer;
