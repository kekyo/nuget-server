// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useRef, useState, useEffect, useCallback } from 'react';
import { Tooltip, Paper } from '@mui/material';
import { TypedMessage, useTypedMessage } from 'typed-message';
import { useSnackbar } from 'notistack';
import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  Box,
  Button,
  Divider,
  IconButton,
  Stack,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  GitHub as GitHubIcon,
  ContentCopy as ContentCopyIcon,
  EditNote,
} from '@mui/icons-material';
import PackageList, { PackageListRef } from './PackageList';
import UploadDrawer from './components/UploadDrawer';
import UserRegistrationDrawer from './components/UserRegistrationDrawer';
import UserPasswordResetDrawer from './components/UserPasswordResetDrawer';
import UserDeleteDrawer from './components/UserDeleteDrawer';
import ApiPasswordDrawer from './components/ApiPasswordDrawer';
import UserPasswordChangeDrawer from './components/UserPasswordChangeDrawer';
import UserAvatarMenu from './components/UserAvatarMenu';
import LoginDialog from './components/LoginDialog';
import { name, repository_url, version } from '../generated/packageMetadata';
import { buildAddSourceCommand } from './utils/commandBuilder';
import { apiFetch } from './utils/apiClient';
import { messages } from '../generated/messages';

export interface ServerConfig {
  realm: string;
  name: string;
  version: string;
  git_commit_hash: string;
  serverUrl: {
    baseUrl?: string;
    port: number;
    isHttps: boolean;
  };
  authMode: 'none' | 'publish' | 'full';
  authEnabled: {
    general: boolean;
    publish: boolean;
    admin: boolean;
  };
  currentUser?: {
    username: string;
    role: string;
    authenticated: boolean;
  } | null;
  availableLanguages?: string[];
}

interface AppContentProps {
  locale: string;
  themeMode: 'auto' | 'light' | 'dark';
  languageNames: Record<string, string>;
  prefersDarkMode: boolean;
  onLanguageChange: (languageCode: string) => void;
  onThemeChange: (mode: 'auto' | 'light' | 'dark') => void;
}

const AppContent = ({
  locale,
  themeMode,
  languageNames,
  prefersDarkMode,
  onLanguageChange,
  onThemeChange,
}: AppContentProps) => {
  const getMessage = useTypedMessage();
  const { enqueueSnackbar } = useSnackbar();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userRegDrawerOpen, setUserRegDrawerOpen] = useState(false);
  const [passwordResetDrawerOpen, setPasswordResetDrawerOpen] = useState(false);
  const [userDeleteDrawerOpen, setUserDeleteDrawerOpen] = useState(false);
  const [apiPasswordDrawerOpen, setApiPasswordDrawerOpen] = useState(false);
  const [passwordChangeDrawerOpen, setPasswordChangeDrawerOpen] =
    useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const packageListRef = useRef<PackageListRef>(null);

  // Check user role using serverConfig.currentUser information
  const checkUserRole = useCallback(async () => {
    try {
      // If auth is disabled, set role based on auth mode
      if (serverConfig?.authMode === 'none') {
        setCurrentUserRole('admin'); // All operations available when auth is disabled
        return;
      }

      // Use serverConfig.currentUser for role information
      if (serverConfig?.currentUser?.authenticated) {
        const role = serverConfig.currentUser.role;
        if (role === 'admin') {
          setCurrentUserRole('admin');
        } else if (role === 'publish') {
          setCurrentUserRole('read-publish');
        } else {
          setCurrentUserRole('readonly');
        }
      } else {
        setCurrentUserRole(null);
      }
    } catch (error) {
      console.error('Failed to check user role:', error);
      setCurrentUserRole('readonly'); // Default to readonly on error
    }
  }, [serverConfig]);

  useEffect(() => {
    fetchServerConfig();
  }, []);

  useEffect(() => {
    if (serverConfig) {
      checkUserRole();
    }
  }, [serverConfig, checkUserRole]);

  // Check authentication status for authMode=full
  useEffect(() => {
    const checkAuthAndShowLogin = async () => {
      if (!serverConfig) return;

      if (
        serverConfig.authMode === 'full' &&
        !serverConfig.currentUser?.authenticated
      ) {
        // Check session status
        try {
          const sessionResponse = await apiFetch('api/auth/session', {
            credentials: 'same-origin',
          });

          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json();
            if (!sessionData.authenticated) {
              // Show login dialog for unauthenticated users in full auth mode
              setLoginDialogOpen(true);
            }
          } else {
            // Show login dialog if session check fails
            setLoginDialogOpen(true);
          }
        } catch (error) {
          console.error('Failed to check session:', error);
          setLoginDialogOpen(true);
        }
      }
    };

    checkAuthAndShowLogin();
  }, [serverConfig]);

  const handleUploadSuccess = () => {
    packageListRef.current?.refresh();
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
  };

  const handleUserRegSuccess = () => {
    // Could refresh user list or show notification here
    console.log('User registered successfully');
  };

  const handleCloseUserRegDrawer = () => {
    setUserRegDrawerOpen(false);
  };

  const handleClosePasswordResetDrawer = () => {
    setPasswordResetDrawerOpen(false);
  };

  const handleCloseUserDeleteDrawer = () => {
    setUserDeleteDrawerOpen(false);
  };

  const handleCloseApiPasswordDrawer = () => {
    setApiPasswordDrawerOpen(false);
  };

  const handleClosePasswordChangeDrawer = () => {
    setPasswordChangeDrawerOpen(false);
  };

  const handleLoginSuccess = (username: string) => {
    setLoginDialogOpen(false);
    // Show success notification
    enqueueSnackbar(getMessage(messages.LOGIN_SUCCESS, { username }), {
      variant: 'success',
    });
    // Refresh server config to get updated authentication state
    fetchServerConfig();
  };

  const handleCloseLoginDialog = () => {
    // Don't close dialog when unauthenticated in authMode=full
    if (
      serverConfig?.authMode === 'full' &&
      !serverConfig?.currentUser?.authenticated
    ) {
      return; // Do nothing
    }
    setLoginDialogOpen(false);
  };

  const fetchServerConfig = async () => {
    try {
      // First try Express endpoint
      let response = await apiFetch('api/config', {
        credentials: 'same-origin',
      });

      // If Express endpoint fails, try Fastify UI endpoint
      if (!response.ok && response.status === 404) {
        response = await apiFetch('api/ui/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          credentials: 'same-origin',
        });
      }

      if (response.ok) {
        const config = await response.json();
        setServerConfig(config);
        // Update document title with realm
        if (config.realm) {
          document.title = config.realm;
        }
      } else if (response.status === 401) {
        // Authentication required - UI will handle this appropriately
        // For authMode=full, login dialog will be shown
        // For authMode=publish, app will work in unauthenticated mode
        console.debug('Authentication required for config endpoint');
        return;
      }
    } catch (error) {
      console.error('Failed to fetch server config:', error);
    }
  };

  // Permission check functions
  const hasPublishPermission = () => {
    return currentUserRole === 'admin' || currentUserRole === 'read-publish';
  };

  const isAuthenticated = () => {
    return serverConfig?.currentUser?.authenticated === true;
  };

  const shouldHideAppBarButtons = () => {
    // Hide buttons while loading serverConfig
    if (!serverConfig) return true;

    // Hide all buttons when login dialog is open in authMode=full
    if (loginDialogOpen && serverConfig.authMode === 'full') {
      return true;
    }

    // Also hide buttons in authMode=full when not authenticated
    // (even before login dialog opens)
    if (
      serverConfig.authMode === 'full' &&
      !serverConfig.currentUser?.authenticated
    ) {
      return true;
    }

    return false;
  };

  // Button visibility condition functions
  const showLoginButton = () => {
    if (!serverConfig) return false;
    if (shouldHideAppBarButtons()) return false;
    const authMode = serverConfig.authMode;
    if (authMode === 'none') return false;
    if (authMode === 'publish') return !isAuthenticated();
    if (authMode === 'full') return !isAuthenticated(); // Show when unauthenticated even in full mode
    return false;
  };

  const showUserAvatarMenu = () => {
    if (!serverConfig) return false;
    if (shouldHideAppBarButtons()) return false;
    // Always show avatar menu regardless of auth mode or authentication status
    return true;
  };

  const showRepositoryInfo = () => {
    if (!serverConfig) return false;
    if (shouldHideAppBarButtons()) return false;
    const authMode = serverConfig.authMode;
    if (authMode === 'full') return false;
    return !!serverConfig.serverUrl;
  };

  const showUploadButton = () => {
    if (!serverConfig) return false;
    if (shouldHideAppBarButtons()) return false;
    const authMode = serverConfig.authMode;
    if (authMode === 'none') return true;
    if (!isAuthenticated()) return false;
    return hasPublishPermission();
  };

  const isAdmin = () => {
    if (!serverConfig) return false;
    const authMode = serverConfig.authMode;
    if (authMode === 'none') return true; // Full access when auth is disabled
    return serverConfig.currentUser?.role === 'admin';
  };

  const canManagePassword = () => {
    if (!serverConfig) return false;
    const authMode = serverConfig.authMode;
    return (authMode === 'publish' || authMode === 'full') && isAuthenticated();
  };

  const handleLogin = () => {
    setLoginDialogOpen(true);
  };

  const handleLogout = async () => {
    try {
      const response = await apiFetch('api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });

      if (response.ok) {
        // Clear local state
        setServerConfig(null);
        setCurrentUserRole(null);
        // Reload to reset the application state
        window.location.reload();
      }
    } catch (error) {
      console.error('Logout failed:', error);
      // Fallback to reload
      window.location.reload();
    }
  };

  const handleCopyCommand = async () => {
    if (serverConfig?.serverUrl) {
      const command = buildAddSourceCommand({
        serverUrl: serverConfig.serverUrl,
      });
      try {
        await navigator.clipboard.writeText(command);
        enqueueSnackbar(getMessage(messages.COPIED_TO_CLIPBOARD), {
          variant: 'success',
        });
      } catch (err) {
        // Fallback for browsers without Clipboard API support
        const textArea = document.createElement('textarea');
        textArea.value = command;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        enqueueSnackbar(getMessage(messages.COPIED_TO_CLIPBOARD), {
          variant: 'success',
        });
      }
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="fixed">
        <Toolbar>
          <img
            src="/icon.png"
            alt={serverConfig?.realm || 'nuget-server'}
            style={{
              height: '2.3rem',
              width: '2.3rem',
              marginRight: '1rem',
            }}
          />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {serverConfig?.realm || 'nuget-server'}
          </Typography>

          {/* GitHub Link */}
          {!shouldHideAppBarButtons() && (
            <>
              <Tooltip title={`${name} ${version}`}>
                <GitHubIcon
                  color="inherit"
                  onClick={() => window.open(repository_url, '_blank')}
                  sx={{ mx: 1, cursor: 'pointer' }}
                />
              </Tooltip>
              <Divider
                orientation="vertical"
                flexItem
                sx={{ mx: 1, borderColor: 'rgba(255, 255, 255, 0.3)' }}
              />
            </>
          )}

          {/* Upload Button */}
          {showUploadButton() && (
            <Button
              color="inherit"
              startIcon={<UploadIcon />}
              onClick={() => setDrawerOpen(true)}
              sx={{ mr: 1 }}
            >
              <TypedMessage message={messages.UPLOAD} />
            </Button>
          )}

          {/* User Avatar Menu */}
          {showUserAvatarMenu() && (
            <UserAvatarMenu
              username={
                serverConfig?.authMode === 'none'
                  ? 'Admin'
                  : serverConfig?.currentUser?.username
              }
              authMode={serverConfig?.authMode}
              isAuthenticated={isAuthenticated()}
              isAdmin={isAdmin()}
              canManagePassword={canManagePassword()}
              showLogin={showLoginButton()}
              currentLocale={locale}
              availableLanguages={serverConfig?.availableLanguages || ['en']}
              languageNames={languageNames}
              currentTheme={themeMode}
              effectiveTheme={
                themeMode === 'auto'
                  ? prefersDarkMode
                    ? 'dark'
                    : 'light'
                  : themeMode
              }
              onLogin={handleLogin}
              onAddUser={() => setUserRegDrawerOpen(true)}
              onResetPassword={() => setPasswordResetDrawerOpen(true)}
              onDeleteUser={() => setUserDeleteDrawerOpen(true)}
              onChangePassword={() => setPasswordChangeDrawerOpen(true)}
              onApiPassword={() => setApiPasswordDrawerOpen(true)}
              onLogout={handleLogout}
              onLanguageChange={onLanguageChange}
              onThemeChange={onThemeChange}
            />
          )}
        </Toolbar>
      </AppBar>

      {showRepositoryInfo() && (
        <Container maxWidth="lg" sx={{ mt: 12, mb: 4 }}>
          <Paper
            elevation={1}
            sx={{
              p: 2,
              bgcolor: (theme) =>
                theme.palette.mode === 'light' ? 'primary.50' : 'grey.900',
              borderColor: (theme) =>
                theme.palette.mode === 'light' ? 'primary.100' : 'grey.800',
              borderWidth: 1,
              borderStyle: 'solid',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Box sx={{ flexGrow: 1 }}>
                <Stack direction="row">
                  <Typography
                    variant="body2"
                    fontSize="1.3rem"
                    color="text.secondary"
                    gutterBottom
                  >
                    <EditNote fontSize="small" />
                    <TypedMessage message={messages.ADD_SERVER_AS_SOURCE} />
                  </Typography>
                </Stack>
                <Typography
                  variant="body2"
                  marginLeft="1rem"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '1rem',
                    wordBreak: 'break-all',
                  }}
                >
                  {buildAddSourceCommand({
                    serverUrl: serverConfig!.serverUrl,
                  })}
                </Typography>
              </Box>
              <IconButton
                size="large"
                onClick={handleCopyCommand}
                aria-label="copy command"
                sx={{ ml: 1, marginRight: '1rem' }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Box>
          </Paper>
        </Container>
      )}

      <Container
        maxWidth="lg"
        sx={{
          mt: showRepositoryInfo() ? 1 : 13,
          mb: 4,
          pr:
            drawerOpen ||
            userRegDrawerOpen ||
            passwordResetDrawerOpen ||
            userDeleteDrawerOpen ||
            apiPasswordDrawerOpen ||
            passwordChangeDrawerOpen
              ? '500px'
              : undefined,
        }}
      >
        <PackageList ref={packageListRef} serverConfig={serverConfig} />
      </Container>

      <UploadDrawer
        open={drawerOpen}
        onClose={handleCloseDrawer}
        onUploadSuccess={handleUploadSuccess}
      />

      <UserRegistrationDrawer
        open={userRegDrawerOpen}
        onClose={handleCloseUserRegDrawer}
        onRegistrationSuccess={handleUserRegSuccess}
      />

      <UserPasswordResetDrawer
        open={passwordResetDrawerOpen}
        onClose={handleClosePasswordResetDrawer}
      />

      <UserDeleteDrawer
        open={userDeleteDrawerOpen}
        onClose={handleCloseUserDeleteDrawer}
        currentUsername={serverConfig?.currentUser?.username}
      />

      <ApiPasswordDrawer
        open={apiPasswordDrawerOpen}
        onClose={handleCloseApiPasswordDrawer}
        serverConfig={serverConfig}
      />

      <UserPasswordChangeDrawer
        open={passwordChangeDrawerOpen}
        onClose={handleClosePasswordChangeDrawer}
      />

      <LoginDialog
        open={loginDialogOpen}
        onClose={handleCloseLoginDialog}
        onLoginSuccess={handleLoginSuccess}
        realm={serverConfig?.realm || 'NuGet Server'}
        disableBackdropClick={serverConfig?.authMode === 'full'}
      />
    </Box>
  );
};

export default AppContent;
