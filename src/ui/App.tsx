// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState, useEffect, useMemo } from 'react';
import {
  CssBaseline,
  ThemeProvider,
  createTheme,
  useMediaQuery,
} from '@mui/material';
import { SnackbarProvider } from 'notistack';
import { TypedMessageProvider } from 'typed-message';
import AppContentUI, { ServerConfig } from './AppContent';
import { apiFetch, setSessionHandler } from './utils/apiClient';
import { SessionProvider, useSession } from './contexts/SessionContext';

// Language detection function
const detectLanguage = (availableLanguages?: string[]): string => {
  // Check localStorage first
  const savedLocale = localStorage.getItem('preferredLocale');
  if (savedLocale && savedLocale !== 'auto') {
    // Verify saved locale is still available
    if (!availableLanguages || availableLanguages.includes(savedLocale)) {
      return savedLocale;
    }
  }

  // Auto-detect from browser
  const browserLang = navigator.language.toLowerCase();
  const langCode = browserLang.split('-')[0];

  // Check if browser language is available
  if (langCode && availableLanguages && availableLanguages.includes(langCode)) {
    return langCode;
  }

  // Default to English
  return 'en';
};

const AppContent = () => {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const [locale, setLocale] = useState(detectLanguage());
  const [localeMessages, setLocaleMessages] = useState<Record<string, string>>(
    {}
  );
  const [themeMode, setThemeMode] = useState<'auto' | 'light' | 'dark'>(() => {
    const saved = localStorage.getItem('preferredTheme');
    return (saved as 'auto' | 'light' | 'dark') || 'auto';
  });
  const [languageNames, setLanguageNames] = useState<Record<string, string>>(
    {}
  );
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode:
            themeMode === 'auto'
              ? prefersDarkMode
                ? 'dark'
                : 'light'
              : themeMode === 'dark'
                ? 'dark'
                : 'light',
          primary: {
            main:
              themeMode === 'dark' || (themeMode === 'auto' && prefersDarkMode)
                ? '#90caf9'
                : '#1976d2',
            50: '#e3f2fd',
            100: '#bbdefb',
          },
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
      }),
    [themeMode, prefersDarkMode]
  );

  useEffect(() => {
    fetchServerConfig();
  }, []);

  // Update locale when serverConfig changes (to use available languages)
  useEffect(() => {
    if (serverConfig?.availableLanguages) {
      const detectedLang = detectLanguage(serverConfig.availableLanguages);
      if (detectedLang !== locale) {
        setLocale(detectedLang);
      }
    }
  }, [serverConfig?.availableLanguages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load locale messages
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const response = await fetch(`/locale/${locale}.json`);
        if (response.ok) {
          const messages = await response.json();
          setLocaleMessages(messages);
        }
      } catch (error) {
        console.error('Failed to load locale messages:', error);
      }
    };
    loadMessages();
  }, [locale]);

  // Load language names for all available languages
  useEffect(() => {
    const fetchLanguageNames = async () => {
      if (!serverConfig?.availableLanguages) return;

      const names: Record<string, string> = {};
      for (const lang of serverConfig.availableLanguages) {
        try {
          const response = await fetch(`/locale/${lang}.json`);
          if (response.ok) {
            const messages = await response.json();
            names[lang] = messages.LANGUAGE_NAME || lang.toUpperCase();
          }
        } catch (error) {
          names[lang] = lang.toUpperCase();
        }
      }
      setLanguageNames(names);
    };

    fetchLanguageNames();
  }, [serverConfig?.availableLanguages]);

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
      } else if (response.status === 401) {
        // Authentication required - UI will handle this appropriately
        // For authMode=full, AppContent will show login dialog
        // For authMode=publish, app will work in unauthenticated mode
        console.debug('Authentication required for config endpoint');
        return;
      }
    } catch (error) {
      console.error('Failed to fetch server config:', error);
    }
  };

  const handleLanguageChange = (languageCode: string) => {
    if (languageCode === 'auto') {
      localStorage.removeItem('preferredLocale');
      // Re-detect browser language
      const detectedLang = detectLanguage(serverConfig?.availableLanguages);
      setLocale(detectedLang);
    } else {
      localStorage.setItem('preferredLocale', languageCode);
      setLocale(languageCode);
    }
  };

  const handleThemeChange = (mode: 'auto' | 'light' | 'dark') => {
    setThemeMode(mode);
    if (mode === 'auto') {
      localStorage.removeItem('preferredTheme');
    } else {
      localStorage.setItem('preferredTheme', mode);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider
        maxSnack={3}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        autoHideDuration={2000}
      >
        <TypedMessageProvider messages={localeMessages}>
          <SessionProvider>
            <AppContentWrapper
              locale={locale}
              themeMode={themeMode}
              languageNames={languageNames}
              prefersDarkMode={prefersDarkMode}
              onLanguageChange={handleLanguageChange}
              onThemeChange={handleThemeChange}
              serverConfig={serverConfig}
            />
          </SessionProvider>
        </TypedMessageProvider>
      </SnackbarProvider>
    </ThemeProvider>
  );
};

// Wrapper component that uses SessionContext
const AppContentWrapper = (props: any) => {
  const { handleSessionExpired, setLoginDialogOpen, loginDialogOpen } =
    useSession();

  // Set up session handler when serverConfig changes
  useEffect(() => {
    if (props.serverConfig?.authMode) {
      setSessionHandler(handleSessionExpired, props.serverConfig.authMode);
    }
  }, [props.serverConfig?.authMode, handleSessionExpired]);

  return (
    <AppContentUI
      {...props}
      setLoginDialogOpen={setLoginDialogOpen}
      loginDialogOpenFromSession={loginDialogOpen}
    />
  );
};

const App = () => {
  return <AppContent />;
};

export default App;
