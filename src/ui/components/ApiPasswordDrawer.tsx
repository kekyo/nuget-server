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
} from "@mui/material";
import {
  Close as CloseIcon,
  VpnKey as VpnKeyIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import { buildAddSourceCommand } from "../utils/commandBuilder";
import { apiFetch } from "../utils/apiClient";
import { TypedMessage, useTypedMessage } from "typed-message";
import { messages } from "../../generated/messages";

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
  const [loading, setLoading] = useState(false);
  const [apiPasswords, setApiPasswords] = useState<ApiPassword[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newApiPassword, setNewApiPassword] =
    useState<ApiPasswordAddResponse | null>(null);
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string>("");

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
      setNewLabel("");
    }
  }, [open, serverConfig]);

  const loadApiPasswords = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch("api/ui/apipasswords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "list" }),
        credentials: "same-origin",
      });

      if (response.ok) {
        const data: ApiPasswordListResponse = await response.json();
        setApiPasswords(data.apiPasswords);
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(
          errorData.error || getMessage(messages.FAILED_TO_LOAD_API_PASSWORDS),
        );
      }
    } catch (err) {
      setError(
        `${getMessage(messages.ERROR)}: ${err instanceof Error ? err.message : getMessage(messages.UNKNOWN_ERROR)}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAddApiPassword = async () => {
    if (!newLabel.trim()) {
      setError(getMessage(messages.TABLE_LABEL) + " cannot be empty");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch("api/ui/apipasswords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "add", label: newLabel.trim() }),
        credentials: "same-origin",
      });

      if (response.ok) {
        const data: ApiPasswordAddResponse = await response.json();
        setNewApiPassword(data);
        setAddDialogOpen(false);
        setNewLabel("");
        // Reload the list
        await loadApiPasswords();
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(
          errorData.error || getMessage(messages.API_KEY_GENERATION_FAILED),
        );
      }
    } catch (err) {
      setError(
        `${getMessage(messages.ERROR)}: ${err instanceof Error ? err.message : getMessage(messages.UNKNOWN_ERROR)}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteApiPassword = async (label: string) => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch("api/ui/apipasswords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "delete", label }),
        credentials: "same-origin",
      });

      if (response.ok) {
        setDeleteConfirmDialog(null);
        // Reload the list
        await loadApiPasswords();
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(
          errorData.error || getMessage(messages.FAILED_TO_DELETE_API_PASSWORD),
        );
      }
    } catch (err) {
      setError(
        `${getMessage(messages.ERROR)}: ${err instanceof Error ? err.message : getMessage(messages.UNKNOWN_ERROR)}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // Fallback for browsers without Clipboard API support
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
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
          "& .MuiDrawer-paper": {
            width: 500,
            boxSizing: "border-box",
          },
        }}
      >
        <Box sx={{ p: 3, height: "100%", overflowY: "auto" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
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
              <Typography variant="body2" sx={{ fontWeight: "bold", mb: 1 }}>
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
                    theme.palette.mode === "dark" ? "grey.800" : "grey.100",
                  border: "2px dashed",
                  borderColor: "primary.main",
                  cursor: "pointer",
                  "&:hover": {
                    bgcolor: (theme) =>
                      theme.palette.mode === "dark" ? "grey.700" : "grey.200",
                  },
                }}
                onClick={() => copyToClipboard(newApiPassword.apiPassword)}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: "monospace",
                    fontSize: "0.9rem",
                    wordBreak: "break-all",
                    mb: 1,
                  }}
                >
                  {newApiPassword.apiPassword}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  <TypedMessage message={messages.CLICK_COPY_SHOWN_ONCE} />
                </Typography>
              </Paper>

              {serverConfig.authMode === "full" && currentUsername && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    <TypedMessage message={messages.EXAMPLE_COMMANDS} />
                  </Typography>
                  <Paper
                    sx={{
                      p: 1,
                      mt: 1,
                      bgcolor: "grey.900",
                      color: "grey.100",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                    }}
                    onClick={() =>
                      copyToClipboard(
                        buildAddSourceCommand({
                          serverUrl: serverConfig.serverUrl,
                          username: currentUsername,
                          apiPassword: newApiPassword.apiPassword,
                        }),
                      )
                    }
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                        wordBreak: "break-all",
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

          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 2,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              <TypedMessage
                message={messages.API_PASSWORDS_COUNT}
                params={{ current: apiPasswords.length }}
              />
            </Typography>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setAddDialogOpen(true)}
              disabled={loading || apiPasswords.length >= 10}
            >
              <TypedMessage message={messages.ADD_NEW} />
            </Button>
          </Box>

          {loading && !apiPasswords.length ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
              <CircularProgress />
            </Box>
          ) : apiPasswords.length === 0 ? (
            <Paper sx={{ p: 3, textAlign: "center" }}>
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
                          sx={{ fontFamily: "monospace" }}
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
                          onClick={() => setDeleteConfirmDialog(apiPwd.label)}
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

          {apiPasswords.length >= 10 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              <TypedMessage message={messages.MAX_API_PASSWORDS} />
            </Alert>
          )}
        </Box>
      </Drawer>

      {/* Add Dialog */}
      <Dialog
        open={addDialogOpen}
        onClose={() => !loading && setAddDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <TypedMessage message={messages.ADD_NEW_API_PASSWORD_TITLE} />
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label={getMessage(messages.TABLE_LABEL)}
            type="text"
            fullWidth
            variant="outlined"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            disabled={loading}
            helperText={getMessage(messages.API_PASSWORD_LABEL_HELPER)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialogOpen(false)} disabled={loading}>
            <TypedMessage message={messages.CANCEL} />
          </Button>
          <Button
            onClick={handleAddApiPassword}
            variant="contained"
            disabled={loading || !newLabel.trim()}
            startIcon={
              loading ? <CircularProgress size={20} /> : <VpnKeyIcon />
            }
          >
            <TypedMessage message={messages.GENERATE} />
          </Button>
        </DialogActions>
      </Dialog>

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
              params={{ label: deleteConfirmDialog || "" }}
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
