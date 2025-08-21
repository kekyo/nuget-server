// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useRef, useState, useEffect } from 'react';
import { CssBaseline, ThemeProvider, createTheme, useMediaQuery } from '@mui/material';
import { AppBar, Toolbar, Typography, Container, IconButton, Box } from '@mui/material';
import { CloudUpload as UploadIcon } from '@mui/icons-material';
import PackageList, { PackageListRef } from './PackageList';
import UploadDrawer from './components/UploadDrawer';

interface ServerConfig {
  realm: string;
  name: string;
  version: string;
  git_commit_hash: string;
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
        const response = await fetch('/api/config');
        if (response.ok) {
          const config = await response.json();
          setServerConfig(config);
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
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              {serverConfig?.realm || 'NuGet Server'}
            </Typography>
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
            pr: drawerOpen ? '400px' : undefined,
            flexGrow: 1
          }}
        >
          <PackageList ref={packageListRef} />
        </Container>

        {/* Footer */}
        <Box 
          component="footer"
          sx={{ 
            py: 2, 
            px: 3, 
            mt: 'auto',
            backgroundColor: theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
            borderTop: 1,
            borderColor: 'divider'
          }}
        >
          <Typography variant="body2" color="text.secondary" align="right">
            <a 
              href="https://github.com/kekyo/nuget-server"
              target="_blank"
              rel="noopener noreferrer"
              style={{ 
                color: 'inherit', 
                textDecoration: 'none' 
              }}
            >
              {serverConfig ? `${serverConfig.name} [${serverConfig.version}-${serverConfig.git_commit_hash}]` : 'NuGet Server'}
            </a>
          </Typography>
        </Box>

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
