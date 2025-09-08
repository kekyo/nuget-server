// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { useSnackbar } from 'notistack';
import { useTypedMessage } from 'typed-message';
import { messages } from '../../generated/messages';

interface SessionContextType {
  handleSessionExpired: (authMode: 'none' | 'publish' | 'full') => void;
  setLoginDialogOpen: (open: boolean) => void;
  loginDialogOpen: boolean;
  clearSession: () => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};

interface SessionProviderProps {
  children: ReactNode;
  onLoginDialogChange?: (open: boolean) => void;
}

export const SessionProvider = ({
  children,
  onLoginDialogChange,
}: SessionProviderProps) => {
  const getMessage = useTypedMessage();
  const { enqueueSnackbar } = useSnackbar();
  const [loginDialogOpen, setLoginDialogOpenState] = useState(false);

  const setLoginDialogOpen = useCallback(
    (open: boolean) => {
      setLoginDialogOpenState(open);
      onLoginDialogChange?.(open);
    },
    [onLoginDialogChange]
  );

  const clearSession = useCallback(() => {
    // Clear any stored authentication data
    localStorage.removeItem('authToken');
    sessionStorage.removeItem('authToken');
  }, []);

  const handleSessionExpired = useCallback(
    (authMode: 'none' | 'publish' | 'full') => {
      // Clear session data
      clearSession();

      if (authMode === 'full') {
        // For full auth mode, show login dialog
        setLoginDialogOpen(true);
        enqueueSnackbar(getMessage(messages.SESSION_EXPIRED_LOGIN_REQUIRED), {
          variant: 'warning',
        });
      } else if (authMode === 'publish') {
        // For publish auth mode, reload to show package list in unauthenticated state
        enqueueSnackbar(getMessage(messages.SESSION_EXPIRED), {
          variant: 'info',
        });
        // Reload the page to reset to unauthenticated state
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
      // For authMode === 'none', do nothing as auth is disabled
    },
    [clearSession, setLoginDialogOpen, enqueueSnackbar, getMessage]
  );

  const contextValue: SessionContextType = {
    handleSessionExpired,
    setLoginDialogOpen,
    loginDialogOpen,
    clearSession,
  };

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
    </SessionContext.Provider>
  );
};
