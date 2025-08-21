// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useRef, useState } from 'react';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { AppBar, Toolbar, Typography, Container, Fab } from '@mui/material';
import { CloudUpload as UploadIcon } from '@mui/icons-material';
import PackageList, { PackageListRef } from './PackageList';
import UploadDrawer from './components/UploadDrawer';
import { name, version } from '../generated/packageMetadata';

const theme = createTheme({
  palette: {
    mode: 'dark',
  },
});

const App = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const packageListRef = useRef<PackageListRef>(null);

  const handleUploadSuccess = () => {
    packageListRef.current?.refresh();
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {name} {version}
          </Typography>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4, pr: drawerOpen ? '400px' : undefined }}>
        <PackageList ref={packageListRef} />
      </Container>
      
      <Fab
        color="primary"
        aria-label="upload"
        sx={{
          position: 'fixed',
          bottom: 16,
          right: 16,
        }}
        onClick={() => setDrawerOpen(true)}
      >
        <UploadIcon />
      </Fab>

      <UploadDrawer
        open={drawerOpen}
        onClose={handleCloseDrawer}
        onUploadSuccess={handleUploadSuccess}
      />
    </ThemeProvider>
  );
};

export default App;
