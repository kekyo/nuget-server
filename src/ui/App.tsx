// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useRef, useState, useEffect } from 'react';
import { CssBaseline, ThemeProvider, createTheme, useMediaQuery } from '@mui/material';
import { AppBar, Toolbar, Typography, Container, IconButton, Box, Tooltip } from '@mui/material';
import { CloudUpload as UploadIcon, GitHub as GitHubIcon } from '@mui/icons-material';
import PackageList, { PackageListRef } from './PackageList';
import UploadDrawer from './components/UploadDrawer';
import NUGET_SERVER_ICON_BASE64 from '../../images/nuget-server-120.png';

interface ServerConfig {
  realm: string;
  name: string;
  version: string;
  git_commit_hash: string;
  addSourceCommand: string;
}

const App = () => {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const packageListRef = useRef<PackageListRef>(null);
  
  const theme = createTheme({
    palette: {
      mode: prefersDarkMode ? 'dark' : 'light',
    },
  });

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

  const handleUploadSuccess = () => {
    packageListRef.current?.refresh();
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
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
            <Tooltip title={serverConfig ? `${serverConfig.name}-${serverConfig.version}` : 'NuGet Server'}>
              <IconButton
                color="inherit"
                aria-label="view source code"
                onClick={() => window.open('https://github.com/kekyo/nuget-server', '_blank')}
                sx={{ mr: 1 }}
              >
                <GitHubIcon />
              </IconButton>
            </Tooltip>
            <IconButton
              color="inherit"
              aria-label="upload package"
              onClick={() => setDrawerOpen(true)}
            >
              <UploadIcon />
            </IconButton>
          </Toolbar>
        </AppBar>
        
        <Container 
          maxWidth="lg" 
          sx={{ 
            mt: 12, 
            mb: 4, 
            pr: drawerOpen ? '400px' : undefined
          }}
        >
          <PackageList ref={packageListRef} serverConfig={serverConfig} />
        </Container>

        <UploadDrawer
          open={drawerOpen}
          onClose={handleCloseDrawer}
          onUploadSuccess={handleUploadSuccess}
        />
      </Box>
    </ThemeProvider>
  );
};

export default App;
