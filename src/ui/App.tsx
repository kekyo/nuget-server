// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useRef, useState, useEffect, useCallback } from 'react';
import { CssBaseline, ThemeProvider, createTheme, useMediaQuery } from '@mui/material';
import { AppBar, Toolbar, Typography, Container, IconButton, Box, Tooltip, Button, Divider } from '@mui/material';
import { CloudUpload as UploadIcon, GitHub as GitHubIcon, PersonAdd as PersonAddIcon, Login as LoginIcon, Logout as LogoutIcon } from '@mui/icons-material';
import PackageList, { PackageListRef } from './PackageList';
import UploadDrawer from './components/UploadDrawer';
import UserRegistrationDrawer from './components/UserRegistrationDrawer';
import NUGET_SERVER_ICON_BASE64 from '../../images/nuget-server-120.png';

interface ServerConfig {
  realm: string;
  name: string;
  version: string;
  git_commit_hash: string;
  addSourceCommand: string;
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
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const packageListRef = useRef<PackageListRef>(null);
  
  const theme = createTheme({
    palette: {
      mode: prefersDarkMode ? 'dark' : 'light',
    },
  });

  // Check user role by attempting to access admin endpoint
  const checkUserRole = useCallback(async () => {
    try {
      // If auth is disabled, set role based on auth mode
      if (serverConfig?.authMode === 'none') {
        setCurrentUserRole('admin'); // All operations available when auth is disabled
        return;
      }

      // Try to access the useradd endpoint to check if user has admin privileges
      const response = await fetch('/api/useradd', {
        method: 'OPTIONS', // Use OPTIONS to check access without actually posting
        credentials: 'same-origin'
      });
      
      if (response.ok || response.status === 405) { // 405 Method Not Allowed means endpoint exists but OPTIONS not supported
        setCurrentUserRole('admin');
      } else if (response.status === 401 || response.status === 403) {
        // Try publish endpoint to check publish privileges
        const publishResponse = await fetch('/api/publish', {
          method: 'OPTIONS',
          credentials: 'same-origin'
        });
        
        if (publishResponse.ok || publishResponse.status === 405) {
          setCurrentUserRole('read-publish');
        } else {
          setCurrentUserRole('readonly');
        }
      }
    } catch (error) {
      console.error('Failed to check user role:', error);
      setCurrentUserRole('readonly'); // Default to readonly on error
    }
  }, [serverConfig]);

  useEffect(() => {
    const fetchServerConfig = async () => {
      try {
        const response = await fetch('/api/config', {
          credentials: 'same-origin'
        });
        if (response.ok) {
          const config = await response.json();
          setServerConfig(config);
          // Update document title with realm
          if (config.realm) {
            document.title = config.realm;
          }
        } else if (response.status === 401) {
          // Authentication required - reload to trigger browser's Basic auth popup
          window.location.reload();
          return;
        }
      } catch (error) {
        console.error('Failed to fetch server config:', error);
      }
    };

    fetchServerConfig();
  }, []);

  useEffect(() => {
    if (serverConfig) {
      checkUserRole();
    }
  }, [serverConfig, checkUserRole]);

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

  const isAdminUser = currentUserRole === 'admin';

  // 権限判定用の関数
  const hasPublishPermission = () => {
    return currentUserRole === 'admin' || currentUserRole === 'read-publish';
  };

  const hasAdminPermission = () => {
    return currentUserRole === 'admin';
  };

  const isAuthenticated = () => {
    return serverConfig?.currentUser?.authenticated === true;
  };
  
  // Show user registration icon based on auth mode and user role
  const showUserRegistrationIcon = () => {
    if (!serverConfig) return false;
    
    switch (serverConfig.authMode) {
      case 'none':
        return false; // Never show when auth is disabled
      case 'publish':
        return isAdminUser; // Show only for admin users
      case 'full':
        return isAdminUser; // Show only for admin users
      default:
        return false;
    }
  };

  // ボタン表示条件の関数群
  const showLoginButton = () => {
    if (!serverConfig) return false;
    const authMode = serverConfig.authMode;
    if (authMode === 'none') return false;
    if (authMode === 'publish') return !isAuthenticated();
    if (authMode === 'full') return false; // Full modeでは基本的にログイン不要（既に認証済み）
    return false;
  };

  const showLogoutButton = () => {
    if (!serverConfig) return false;
    const authMode = serverConfig.authMode;
    if (authMode === 'none') return false;
    if (authMode === 'publish') return isAuthenticated();
    if (authMode === 'full') return isAuthenticated();
    return false;
  };

  const showUserAddButton = () => {
    if (!serverConfig) return false;
    const authMode = serverConfig.authMode;
    if (authMode === 'none') return false;
    return isAuthenticated() && hasAdminPermission();
  };

  const showUploadButton = () => {
    return true; // 常に表示
  };

  const isUploadEnabled = () => {
    if (!serverConfig) return false;
    const authMode = serverConfig.authMode;
    if (authMode === 'none') return true;
    if (!isAuthenticated()) return false;
    return hasPublishPermission();
  };

  const handleLogin = () => {
    const currentPath = encodeURIComponent(window.location.href);
    window.location.href = `/api/login?redirect=${currentPath}`;
  };

  const handleLogout = () => {
    // Basic認証の場合、完全なログアウトは困難なため、ページをリロードして認証をクリア
    window.location.reload();
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <AppBar position="fixed">
          <Toolbar>
            <img 
              src={NUGET_SERVER_ICON_BASE64} 
              alt="NuGet Server" 
              style={{ height: 40, width: 40, marginRight: 16 }}
            />
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              {serverConfig?.realm || 'NuGet Server'}
            </Typography>
            
            {/* GitHub Link */}
            <Button
              color="inherit"
              startIcon={<GitHubIcon />}
              onClick={() => window.open('https://github.com/kekyo/nuget-server', '_blank')}
              sx={{ mr: 1 }}
            >
              GitHub
            </Button>
            
            {/* Divider */}
            <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: 'rgba(255, 255, 255, 0.3)' }} />
            
            {/* Login Button */}
            {showLoginButton() && (
              <Button
                color="inherit"
                startIcon={<LoginIcon />}
                onClick={handleLogin}
                sx={{ mr: 1 }}
              >
                Login
              </Button>
            )}
            
            {/* Logout Button */}
            {showLogoutButton() && (
              <Button
                color="inherit"
                startIcon={<LogoutIcon />}
                onClick={handleLogout}
                sx={{ mr: 1 }}
              >
                Logout
              </Button>
            )}
            
            {/* User Add Button */}
            {showUserAddButton() && (
              <Button
                color="inherit"
                startIcon={<PersonAddIcon />}
                onClick={() => setUserRegDrawerOpen(true)}
                sx={{ mr: 1 }}
              >
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
                }}
              >
                Upload
              </Button>
            )}
          </Toolbar>
        </AppBar>
        
        <Container 
          maxWidth="lg" 
          sx={{ 
            mt: 12, 
            mb: 4, 
            pr: (drawerOpen || userRegDrawerOpen) ? '400px' : undefined
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
      </Box>
    </ThemeProvider>
  );
};

export default App;
