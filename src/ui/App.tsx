// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { AppBar, Toolbar, Typography, Container } from '@mui/material';
import PackageList from './PackageList';
import { name, version } from '../generated/packageMetadata';

const theme = createTheme({
  palette: {
    mode: 'dark',
  },
});

const App = () => {
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
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <PackageList />
      </Container>
    </ThemeProvider>
  );
};

export default App;
