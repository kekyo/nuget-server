// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState, useEffect } from 'react';
import {
  CssBaseline,
  ThemeProvider,
  createTheme,
  useMediaQuery,
  Box,
  Container,
} from '@mui/material';
import LoginDialog from './components/LoginDialog';
import { apiFetch } from './utils/apiClient';

interface LoginConfigResponse {
  realm?: string;
  authMode?: 'none' | 'publish' | 'full';
}

interface SessionResponse {
  authenticated: boolean;
}

const resolveRedirectPath = (): string => {
  if (typeof window === 'undefined') {
    return '/';
  }

  const requestedPath = new URL(window.location.href).searchParams.get(
    'redirect'
  );
  return requestedPath && requestedPath.startsWith('/') ? requestedPath : '/';
};

/**
 * Determines whether the login page should immediately redirect to the app.
 * @param config Current server config when available.
 * @param session Current session state when available.
 * @returns True when the login page should be skipped.
 */
export const shouldRedirectFromLoginPage = (
  config: Pick<LoginConfigResponse, 'authMode'> | undefined,
  session: Pick<SessionResponse, 'authenticated'> | undefined
): boolean => config?.authMode === 'none' || session?.authenticated === true;

const LoginApp = () => {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [realm, setRealm] = useState('NuGet Server');
  const [authMode, setAuthMode] = useState<'none' | 'publish' | 'full'>('full');

  const theme = createTheme({
    palette: {
      mode: prefersDarkMode ? 'dark' : 'light',
      primary: {
        main: '#1976d2',
      },
      secondary: {
        main: '#dc004e',
      },
    },
    typography: {
      fontFamily: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
          },
        },
      },
    },
  });

  useEffect(() => {
    const initialize = async () => {
      try {
        const [configResponse, sessionResponse] = await Promise.all([
          apiFetch('api/config', {
            credentials: 'same-origin',
          }),
          apiFetch('api/auth/session', {
            credentials: 'same-origin',
          }),
        ]);

        let config: LoginConfigResponse | undefined = undefined;
        if (configResponse.ok) {
          config = (await configResponse.json()) as LoginConfigResponse;
          setRealm(config.realm || 'NuGet Server');
          setAuthMode(config.authMode ?? 'full');
          if (config.realm) {
            document.title = config.realm;
          }
          if (shouldRedirectFromLoginPage(config, undefined)) {
            window.location.replace(resolveRedirectPath());
            return;
          }
        }

        if (sessionResponse.ok) {
          const session = (await sessionResponse.json()) as SessionResponse;
          if (shouldRedirectFromLoginPage(undefined, session)) {
            window.location.replace(resolveRedirectPath());
            return;
          }
        }
      } catch (error) {
        console.error('Failed to fetch server config:', error);
      } finally {
        setLoginDialogOpen(true);
      }
    };

    void initialize();
  }, []);

  const handleLoginSuccess = () => {
    // Redirect to main application after successful login
    window.location.replace(resolveRedirectPath());
  };

  const handleCloseLoginDialog = () => {
    if (authMode === 'full') {
      return;
    }
    setLoginDialogOpen(false);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
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
          disableBackdropClick={authMode === 'full'}
        />
      </Box>
    </ThemeProvider>
  );
};

export default LoginApp;
