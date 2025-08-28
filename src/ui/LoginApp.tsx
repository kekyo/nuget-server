// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState, useEffect } from "react";
import {
  CssBaseline,
  ThemeProvider,
  createTheme,
  useMediaQuery,
  Box,
  Container,
} from "@mui/material";
import LoginDialog from "./components/LoginDialog";

const LoginApp = () => {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [realm, setRealm] = useState("NuGet Server");

  const theme = createTheme({
    palette: {
      mode: prefersDarkMode ? "dark" : "light",
      primary: {
        main: "#1976d2",
      },
      secondary: {
        main: "#dc004e",
      },
    },
    typography: {
      fontFamily: [
        "-apple-system",
        "BlinkMacSystemFont",
        '"Segoe UI"',
        "Roboto",
        '"Helvetica Neue"',
        "Arial",
        "sans-serif",
      ].join(","),
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
          },
        },
      },
    },
  });

  useEffect(() => {
    const fetchServerConfig = async () => {
      try {
        const response = await fetch("/api/config", {
          credentials: "same-origin",
        });
        if (response.ok) {
          const config = await response.json();
          setRealm(config.realm || "NuGet Server");
          if (config.realm) {
            document.title = config.realm;
          }
        }
      } catch (error) {
        console.error("Failed to fetch server config:", error);
      }
    };

    fetchServerConfig();
    // Show login dialog immediately for full auth mode
    setLoginDialogOpen(true);
  }, []);

  const handleLoginSuccess = () => {
    // Redirect to main application after successful login
    window.location.href = "/";
  };

  const handleCloseLoginDialog = () => {
    // In full auth mode, dialog cannot be closed without login
    // This function is kept empty to prevent closing
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Container maxWidth="sm">
          {/* Empty container - login dialog will be shown on top */}
        </Container>

        <LoginDialog
          open={loginDialogOpen}
          onClose={handleCloseLoginDialog}
          onLoginSuccess={handleLoginSuccess}
          realm={realm}
          disableBackdropClick={true} // Cannot be closed in full auth mode
        />
      </Box>
    </ThemeProvider>
  );
};

export default LoginApp;
