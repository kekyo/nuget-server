// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useRef, useState, useEffect, useCallback } from 'react';
import { CssBaseline, ThemeProvider, Tooltip, createTheme, useMediaQuery } from '@mui/material';
import { AppBar, Toolbar, Typography, Container, Box, Button, Divider, IconButton, Stack } from '@mui/material';
import { CloudUpload as UploadIcon, GitHub as GitHubIcon, PersonAdd as PersonAddIcon, Login as LoginIcon, Logout as LogoutIcon, ContentCopy as ContentCopyIcon, EditNote, VpnKey as VpnKeyIcon } from '@mui/icons-material';
import PackageList, { PackageListRef } from './PackageList';
import UploadDrawer from './components/UploadDrawer';
import UserRegistrationDrawer from './components/UserRegistrationDrawer';
import ApiPasswordDrawer from './components/ApiPasswordDrawer';
import LoginDialog from './components/LoginDialog';
import { name, repository_url, version } from '../generated/packageMetadata';
import { buildAddSourceCommand } from './utils/commandBuilder';

interface ServerConfig {
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
}

const App = () => {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userRegDrawerOpen, setUserRegDrawerOpen] = useState(false);
  const [apiPasswordDrawerOpen, setApiPasswordDrawerOpen] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const packageListRef = useRef<PackageListRef>(null);
  
  const theme = createTheme({
    palette: {
      mode: prefersDarkMode ? 'dark' : 'light',
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
      
      if (serverConfig.authMode === 'full' && !serverConfig.currentUser?.authenticated) {
        // Check session status
        try {
          const sessionResponse = await fetch('/api/auth/session', {
            credentials: 'same-origin'
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

  const handleCloseApiPasswordDrawer = () => {
    setApiPasswordDrawerOpen(false);
  };

  const handleLoginSuccess = () => {
    setLoginDialogOpen(false);
    // Refresh server config to get updated authentication state
    fetchServerConfig();
  };

  const handleCloseLoginDialog = () => {
    // Don't close dialog when unauthenticated in authMode=full
    if (serverConfig?.authMode === 'full' && !serverConfig?.currentUser?.authenticated) {
      return; // Do nothing
    }
    setLoginDialogOpen(false);
  };

  const fetchServerConfig = async () => {
    try {
      // First try Express endpoint
      let response = await fetch('/api/config', {
        credentials: 'same-origin'
      });
      
      // If Express endpoint fails, try Fastify UI endpoint
      if (!response.ok && response.status === 404) {
        response = await fetch('/api/ui/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          credentials: 'same-origin'
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
        // Authentication required - don't reload to avoid Basic auth popup
        // The config will be fetched again after login
        console.warn('Authentication required for config endpoint');
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
    if (serverConfig.authMode === 'full' && !serverConfig.currentUser?.authenticated) {
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

  const showLogoutButton = () => {
    if (!serverConfig) return false;
    if (shouldHideAppBarButtons()) return false;
    const authMode = serverConfig.authMode;
    if (authMode === 'none') return false;
    if (authMode === 'publish') return isAuthenticated();
    if (authMode === 'full') return isAuthenticated();
    return false;
  };

  const showUserAddButton = () => {
    if (!serverConfig) return false;
    if (shouldHideAppBarButtons()) return false;
    const authMode = serverConfig.authMode;
    if (authMode === 'none') return false;
    // Use currentUser.role from serverConfig
    return serverConfig.currentUser?.role === 'admin';
  };

  const showApiPasswordButton = () => {
    if (!serverConfig) return false;
    if (shouldHideAppBarButtons()) return false;
    const authMode = serverConfig.authMode;
    return (authMode === 'publish' || authMode === 'full') && isAuthenticated();
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
    return true; // Always show
  };

  const isUploadEnabled = () => {
    if (!serverConfig) return false;
    const authMode = serverConfig.authMode;
    if (authMode === 'none') return true;
    if (!isAuthenticated()) return false;
    return hasPublishPermission();
  };

  const handleLogin = () => {
    setLoginDialogOpen(true);
  };

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin'
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

  const handleCopyCommand = () => {
    if (serverConfig?.serverUrl) {
      const command = buildAddSourceCommand({ serverUrl: serverConfig.serverUrl });
      navigator.clipboard.writeText(command);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <AppBar position="fixed">
          <Toolbar>
            <img 
              src="/icon.png" 
              alt={serverConfig?.realm || 'nuget-server'}
              style={{ height: "2.3rem", width: "2.3rem", marginRight: "1rem" }} />
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              {serverConfig?.realm || 'nuget-server'}
            </Typography>

            {/* GitHub Link */}
            {!shouldHideAppBarButtons() && (
              <Tooltip title={`${name} ${version}`}>
                <GitHubIcon
                  color="inherit"
                  onClick={() => window.open(repository_url, '_blank')}
                  sx={{ mx: 1 }} />
              </Tooltip>
            )}

            {/* Divider */}
            {!shouldHideAppBarButtons() && (
              <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: 'rgba(255, 255, 255, 0.3)' }} />
            )}

            {/* User Add Button */}
            {showUserAddButton() && (
              <Button
                color="inherit"
                startIcon={<PersonAddIcon />}
                onClick={() => setUserRegDrawerOpen(true)}
                sx={{ mr: 1 }}>
                Add User
              </Button>
            )}

            {/* Upload Button */}
            {showUploadButton() && (
              <Button
                color="inherit"
                startIcon={<UploadIcon />}
                onClick={() => setDrawerOpen(true)}
                disabled={!isUploadEnabled()}
                sx={{ 
                  opacity: isUploadEnabled() ? 1 : 0.5,
                  cursor: isUploadEnabled() ? 'pointer' : 'not-allowed'
                }}>
                Upload
              </Button>
            )}

            {/* Login Button */}
            {showLoginButton() && (
              <>
                <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: 'rgba(255, 255, 255, 0.3)' }} />
                <Button
                  color="inherit"
                  startIcon={<LoginIcon />}
                  onClick={handleLogin}
                  sx={{ mr: 1 }}>
                  Login
                </Button>
              </>
            )}

            {/* API Password Button */}
            {showApiPasswordButton() && (
              <>
                <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: 'rgba(255, 255, 255, 0.3)' }} />
                <Button
                  color="inherit"
                  startIcon={<VpnKeyIcon />}
                  onClick={() => setApiPasswordDrawerOpen(true)}
                  sx={{ mr: 1 }}>
                  API Password
                </Button>
              </>
            )}

            {/* Logout Button */}
            {showLogoutButton() && (
              <>
                <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: 'rgba(255, 255, 255, 0.3)' }} />
                <Button
                  color="inherit"
                  startIcon={<LogoutIcon />}
                  onClick={handleLogout}
                  sx={{ mr: 1 }}>
                  Logout
                </Button>
              </>
            )}
          </Toolbar>
        </AppBar>

        {showRepositoryInfo() && (
          <Container maxWidth="lg" sx={{ mt: 12, mb: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ flexGrow: 1 }}>
                <Stack direction="row">
                  <Typography variant="body2" fontSize="1.3rem" color="text.secondary" gutterBottom>
                    <EditNote fontSize="small" />
                    Add this server as a NuGet source:
                  </Typography>
                </Stack>
                <Typography 
                  variant="body2" marginLeft="1rem"
                  sx={{ 
                    fontFamily: 'monospace',
                    fontSize: '1rem',
                    wordBreak: 'break-all'
                  }}>
                  {buildAddSourceCommand({ serverUrl: serverConfig!.serverUrl })}
                </Typography>
              </Box>
              <IconButton 
                size="small" 
                onClick={handleCopyCommand}
                aria-label="copy command"
                sx={{ ml: 1, marginRight: "1rem" }}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Box>
          </Container>
        )}

        <Container 
          maxWidth="lg" 
          sx={{ 
            mt: showRepositoryInfo() ? 1 : 13,
            mb: 4,
            pr: (drawerOpen || userRegDrawerOpen || apiPasswordDrawerOpen) ? '500px' : undefined
          }}>
          <PackageList ref={packageListRef} serverConfig={serverConfig} />
        </Container>

        <UploadDrawer
          open={drawerOpen}
          onClose={handleCloseDrawer}
          onUploadSuccess={handleUploadSuccess} />

        <UserRegistrationDrawer
          open={userRegDrawerOpen}
          onClose={handleCloseUserRegDrawer}
          onRegistrationSuccess={handleUserRegSuccess}
          />

        <ApiPasswordDrawer
          open={apiPasswordDrawerOpen}
          onClose={handleCloseApiPasswordDrawer}
          serverConfig={serverConfig}
          />

        <LoginDialog
          open={loginDialogOpen}
          onClose={handleCloseLoginDialog}
          onLoginSuccess={handleLoginSuccess}
          realm={serverConfig?.realm || 'NuGet Server'}
          disableBackdropClick={serverConfig?.authMode === 'full'} />
      </Box>
    </ThemeProvider>
  );
};

export default App;
