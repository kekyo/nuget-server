// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState } from "react";
import {
  Container,
  Paper,
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
} from "@mui/material";
import { Login as LoginIcon } from "@mui/icons-material";
import { apiFetch } from "./utils/apiClient";

interface LoginResponse {
  success: boolean;
  message: string;
  user?: {
    username: string;
    role: string;
  };
}

const Login = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!username.trim() || !password.trim()) {
      setError("Username and password are required");
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
        // Login successful, redirect to main page
        window.location.href = ".";
      } else {
        setError(data.message || "Login failed");
      }
    } catch (err) {
      setError("Network error. Please try again.");
      console.error("Login error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container
      component="main"
      maxWidth="sm"
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        py: 2,
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: isMobile ? 3 : 4,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            mb: 3,
          }}
        >
          <LoginIcon
            sx={{
              fontSize: 48,
              color: theme.palette.primary.main,
              mb: 1,
            }}
          />
          <Typography
            component="h1"
            variant="h4"
            sx={{
              fontWeight: "bold",
              mb: 1,
            }}
          >
            NuGet Server
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Please sign in to continue
          </Typography>
        </Box>

        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            width: "100%",
            maxWidth: 400,
          }}
        >
          {error && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              onClose={() => setError(null)}
            >
              {error}
            </Alert>
          )}

          <TextField
            margin="normal"
            required
            fullWidth
            id="username"
            label="Username"
            name="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isLoading}
            variant="outlined"
          />

          <TextField
            margin="normal"
            required
            fullWidth
            name="password"
            label="Password"
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
            label="Remember me for 7 days"
            sx={{ mt: 1, mb: 2 }}
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
            {isLoading ? "Signing in..." : "Sign In"}
          </Button>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Need help? Contact your system administrator.
        </Typography>
      </Paper>
    </Container>
  );
};

export default Login;
