// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState, useEffect } from "react";
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
} from "@mui/material";
import {
  Close as CloseIcon,
  PersonRemove as PersonRemoveIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
} from "@mui/icons-material";

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
      const response = await fetch("/api/ui/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ action: "list" }),
      });

      if (response.ok) {
        const data = await response.json();
        // Filter out the current user to prevent self-deletion
        const filteredUsers = (data.users || []).filter(
          (user: User) => user.username !== currentUsername,
        );
        setUsers(filteredUsers);
      } else if (response.status === 401) {
        // Authentication required
        window.location.reload();
      } else {
        setResult({
          success: false,
          message: `Failed to load users: ${response.statusText}`,
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: `Error loading users: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleDeleteClick = () => {
    if (!selectedUsername) {
      setResult({
        success: false,
        message: "Please select a user to delete",
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
      const response = await fetch("/api/ui/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "delete",
          username: selectedUsername,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult({
          success: true,
          message: data.message || "User deleted successfully",
        });
        if (onDeleteSuccess) {
          onDeleteSuccess();
        }
        // Reload users list
        loadUsers();
      } else if (response.status === 401) {
        // Authentication required
        window.location.reload();
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
        message: `Delete error: ${error instanceof Error ? error.message : "Unknown error"}`,
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
          "& .MuiDrawer-paper": {
            width: 400,
            boxSizing: "border-box",
          },
        }}
      >
        <Box sx={{ p: 3, height: "100%" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 3,
            }}
          >
            <Typography variant="h6" component="h2">
              Delete User
            </Typography>
            <IconButton onClick={handleClose} edge="end">
              <CloseIcon />
            </IconButton>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {!result ? (
            <Box>
              <Typography variant="body1" sx={{ mb: 3 }}>
                Select a user to delete:
              </Typography>

              {loadingUsers ? (
                <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <>
                  {users.length === 0 ? (
                    <Alert severity="info" sx={{ mb: 3 }}>
                      No users available to delete. You cannot delete your own
                      account.
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
                            newValue ? newValue.username : null,
                          );
                        }}
                        disabled={deleting}
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

                      {selectedUser && (
                        <Paper
                          sx={{ p: 2, mb: 3, bgcolor: "warning.dark" }}
                          variant="outlined"
                          elevation={0}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              mb: 1,
                            }}
                          >
                            <WarningIcon
                              sx={{ mr: 1, color: "warning.main" }}
                            />
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: "bold" }}
                            >
                              Warning
                            </Typography>
                          </Box>
                          <Typography variant="body2">
                            This action cannot be undone. The user{" "}
                            <strong>{selectedUser.username}</strong> and all
                            associated data will be permanently deleted.
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
                        {deleting ? "Deleting..." : "Delete User"}
                      </Button>
                    </>
                  )}
                </>
              )}
            </Box>
          ) : (
            <Box>
              <Alert
                severity={result.success ? "success" : "error"}
                icon={result.success ? <SuccessIcon /> : <ErrorIcon />}
                sx={{ mb: 3 }}
              >
                {result.success
                  ? "User Deleted Successfully!"
                  : "Delete Failed"}
              </Alert>

              {result.message && (
                <Box sx={{ mb: 3 }}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    gutterBottom
                  >
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
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {result.message}
                    </Typography>
                  </Paper>
                </Box>
              )}

              <Box sx={{ display: "flex", gap: 1 }}>
                {result.success ? (
                  <>
                    <Button
                      variant="outlined"
                      onClick={resetForm}
                      sx={{ flex: 1 }}
                    >
                      Delete Another
                    </Button>
                  </>
                ) : (
                  <Button variant="contained" onClick={handleClose} fullWidth>
                    Close
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
          Confirm User Deletion
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-dialog-description">
            Are you sure you want to delete the user{" "}
            <strong>{selectedUsername}</strong>? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDelete} autoFocus>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDelete}
            color="error"
            variant="contained"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default UserDeleteDrawer;
