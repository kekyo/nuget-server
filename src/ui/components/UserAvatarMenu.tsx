// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState } from 'react';
import { TypedMessage } from 'typed-message';
import { messages } from '../../generated/messages';
import {
  Avatar,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  IconButton,
  ListSubheader,
} from '@mui/material';
import {
  Logout as LogoutIcon,
  PersonAdd as PersonAddIcon,
  LockReset as LockResetIcon,
  PersonRemove as PersonRemoveIcon,
  VpnKey as VpnKeyIcon,
  Login as LoginIcon,
  PersonOutline,
  Language as LanguageIcon,
  Check as CheckIcon,
  Brightness4 as ThemeIcon,
} from '@mui/icons-material';

interface UserAvatarMenuProps {
  username?: string | null;
  authMode?: 'none' | 'publish' | 'full';
  isAuthenticated: boolean;
  isAdmin: boolean;
  canManagePassword: boolean;
  showLogin: boolean;
  currentLocale: string;
  availableLanguages: string[];
  languageNames: Record<string, string>;
  currentTheme: 'auto' | 'light' | 'dark';
  effectiveTheme: 'light' | 'dark';
  onLogin: () => void;
  onAddUser: () => void;
  onResetPassword: () => void;
  onDeleteUser: () => void;
  onChangePassword: () => void;
  onApiPassword: () => void;
  onLogout: () => void;
  onLanguageChange: (code: string) => void;
  onThemeChange: (mode: 'auto' | 'light' | 'dark') => void;
}

const UserAvatarMenu = ({
  username,
  authMode,
  isAuthenticated,
  isAdmin,
  canManagePassword,
  showLogin,
  currentLocale,
  availableLanguages,
  languageNames,
  currentTheme,
  effectiveTheme,
  onLogin,
  onAddUser,
  onResetPassword,
  onDeleteUser,
  onChangePassword,
  onApiPassword,
  onLogout,
  onLanguageChange,
  onThemeChange,
}: UserAvatarMenuProps) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [languageAnchorEl, setLanguageAnchorEl] = useState<null | HTMLElement>(
    null
  );
  const [themeAnchorEl, setThemeAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const languageMenuOpen = Boolean(languageAnchorEl);
  const themeMenuOpen = Boolean(themeAnchorEl);

  // Get first letter of username for avatar
  const getAvatarLetter = () => {
    if (username) {
      return username.charAt(0).toUpperCase();
    }
    return 'A'; // Default for admin when auth is disabled
  };

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
    setLanguageAnchorEl(null);
    setThemeAnchorEl(null);
  };

  const handleAction = (action: () => void) => {
    handleClose();
    action();
  };

  return (
    <>
      <IconButton
        onClick={handleClick}
        size="small"
        sx={{ ml: 2 }}
        aria-controls={open ? 'user-avatar-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
      >
        <Avatar
          sx={{
            width: 32,
            height: 32,
            bgcolor: (theme) =>
              theme.palette.mode === 'light' ? 'grey.500' : 'primary.main',
            fontSize: '1rem',
          }}
        >
          {isAuthenticated && username ? (
            getAvatarLetter()
          ) : (
            <PersonOutline fontSize="small" />
          )}
        </Avatar>
      </IconButton>
      <Menu
        id="user-avatar-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          'aria-labelledby': 'user-avatar-button',
        }}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          elevation: 0,
          sx: {
            overflow: 'visible',
            filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
            mt: 1.5,
            '& .MuiAvatar-root': {
              width: 32,
              height: 32,
              ml: -0.5,
              mr: 1,
            },
            '&:before': {
              content: '""',
              display: 'block',
              position: 'absolute',
              top: 0,
              right: 14,
              width: 10,
              height: 10,
              bgcolor: 'background.paper',
              transform: 'translateY(-50%) rotate(45deg)',
              zIndex: 0,
            },
          },
        }}
      >
        {/* Authentication-related menu items - not shown when authMode=none */}
        {/* Login button when not authenticated - at the top */}
        {authMode !== 'none' &&
          showLogin &&
          !isAuthenticated && [
            <MenuItem key="login" onClick={() => handleAction(onLogin)}>
              <ListItemIcon>
                <LoginIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                <TypedMessage message={messages.LOGIN} />
              </ListItemText>
            </MenuItem>,
            <Divider key="login-divider" />,
          ]}

        {/* User info */}
        {authMode !== 'none' &&
          username &&
          isAuthenticated && [
            <MenuItem key="username" disabled>
              <ListItemText
                primary={username}
                primaryTypographyProps={{
                  fontWeight: 'medium',
                }}
              />
            </MenuItem>,
            <Divider key="username-divider" />,
          ]}

        {/* User Management (Admin only) */}
        {authMode !== 'none' &&
          isAdmin &&
          isAuthenticated && [
            <ListSubheader key="users-header">
              <TypedMessage message={messages.USERS} />
            </ListSubheader>,
            <MenuItem key="add-user" onClick={() => handleAction(onAddUser)}>
              <ListItemIcon>
                <PersonAddIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                <TypedMessage message={messages.ADD_USER} />
              </ListItemText>
            </MenuItem>,
            <MenuItem
              key="reset-password"
              onClick={() => handleAction(onResetPassword)}
            >
              <ListItemIcon>
                <LockResetIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                <TypedMessage message={messages.RESET_PASSWORD} />
              </ListItemText>
            </MenuItem>,
            <MenuItem
              key="delete-user"
              onClick={() => handleAction(onDeleteUser)}
            >
              <ListItemIcon>
                <PersonRemoveIcon fontSize="small" color="error" />
              </ListItemIcon>
              <ListItemText>
                <TypedMessage message={messages.DELETE_USER} />
              </ListItemText>
            </MenuItem>,
            <Divider key="users-divider" />,
          ]}

        {/* Password Management */}
        {authMode !== 'none' &&
          canManagePassword &&
          isAuthenticated && [
            <ListSubheader key="password-header">
              <TypedMessage message={messages.PASSWORD_MENU} />
            </ListSubheader>,
            <MenuItem
              key="change-password"
              onClick={() => handleAction(onChangePassword)}
            >
              <ListItemIcon>
                <LockResetIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                <TypedMessage message={messages.CHANGE_PASSWORD} />
              </ListItemText>
            </MenuItem>,
            <MenuItem
              key="api-password"
              onClick={() => handleAction(onApiPassword)}
            >
              <ListItemIcon>
                <VpnKeyIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                <TypedMessage message={messages.API_PASSWORD} />
              </ListItemText>
            </MenuItem>,
            <Divider key="password-divider" />,
          ]}

        {/* Settings Section - Always shown */}
        <ListSubheader>
          <TypedMessage message={messages.SETTINGS} />
        </ListSubheader>

        {/* Language Menu */}
        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            setLanguageAnchorEl(e.currentTarget);
          }}
        >
          <ListItemIcon>
            <LanguageIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            <TypedMessage message={messages.LANGUAGE} />
            {': '}
            {(() => {
              const savedLocale = localStorage.getItem('preferredLocale');
              const isAutoMode = !savedLocale || savedLocale === 'auto';
              if (isAutoMode) {
                return (
                  <>
                    <TypedMessage message={messages.LANGUAGE_AUTO} />
                    {` (${languageNames[currentLocale] || currentLocale.toUpperCase()})`}
                  </>
                );
              }
              return (
                languageNames[currentLocale] || currentLocale.toUpperCase()
              );
            })()}
          </ListItemText>
        </MenuItem>

        {/* Theme Menu */}
        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            setThemeAnchorEl(e.currentTarget);
          }}
        >
          <ListItemIcon>
            <ThemeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            <TypedMessage message={messages.THEME} />
            {': '}
            {currentTheme === 'auto' ? (
              <>
                <TypedMessage message={messages.THEME_AUTO} />
                {` (${effectiveTheme === 'dark' ? 'Dark' : 'Light'})`}
              </>
            ) : currentTheme === 'dark' ? (
              <TypedMessage message={messages.THEME_DARK} />
            ) : (
              <TypedMessage message={messages.THEME_LIGHT} />
            )}
          </ListItemText>
        </MenuItem>

        {/* Logout - Only show when authenticated and authMode is not none */}
        {authMode !== 'none' &&
          isAuthenticated && [
            <Divider key="logout-divider" />,
            <MenuItem key="logout" onClick={() => handleAction(onLogout)}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                <TypedMessage message={messages.LOGOUT} />
              </ListItemText>
            </MenuItem>,
          ]}
      </Menu>

      {/* Language Submenu */}
      <Menu
        anchorEl={languageAnchorEl}
        open={languageMenuOpen}
        onClose={() => setLanguageAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {/* Auto option */}
        <MenuItem
          onClick={() => {
            handleAction(() => onLanguageChange('auto'));
            setLanguageAnchorEl(null);
          }}
        >
          <ListItemIcon>
            {(!localStorage.getItem('preferredLocale') ||
              localStorage.getItem('preferredLocale') === 'auto') && (
              <CheckIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>
            <TypedMessage message={messages.LANGUAGE_AUTO} />
          </ListItemText>
        </MenuItem>

        <Divider />

        {/* Language options */}
        {availableLanguages.map((lang) => (
          <MenuItem
            key={lang}
            onClick={() => {
              handleAction(() => onLanguageChange(lang));
              setLanguageAnchorEl(null);
            }}
          >
            <ListItemIcon>
              {localStorage.getItem('preferredLocale') === lang && (
                <CheckIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText>
              {languageNames[lang] || lang.toUpperCase()}
            </ListItemText>
          </MenuItem>
        ))}
      </Menu>

      {/* Theme Submenu */}
      <Menu
        anchorEl={themeAnchorEl}
        open={themeMenuOpen}
        onClose={() => setThemeAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {/* Auto option */}
        <MenuItem
          onClick={() => {
            handleAction(() => onThemeChange('auto'));
            setThemeAnchorEl(null);
          }}
        >
          <ListItemIcon>
            {currentTheme === 'auto' && <CheckIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>
            <TypedMessage message={messages.THEME_AUTO} />
            {currentTheme === 'auto' &&
              ` (${effectiveTheme === 'dark' ? 'Dark' : 'Light'})`}
          </ListItemText>
        </MenuItem>

        <Divider />

        {/* Light option */}
        <MenuItem
          onClick={() => {
            handleAction(() => onThemeChange('light'));
            setThemeAnchorEl(null);
          }}
        >
          <ListItemIcon>
            {currentTheme === 'light' && <CheckIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>
            <TypedMessage message={messages.THEME_LIGHT} />
          </ListItemText>
        </MenuItem>

        {/* Dark option */}
        <MenuItem
          onClick={() => {
            handleAction(() => onThemeChange('dark'));
            setThemeAnchorEl(null);
          }}
        >
          <ListItemIcon>
            {currentTheme === 'dark' && <CheckIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>
            <TypedMessage message={messages.THEME_DARK} />
          </ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
};

export default UserAvatarMenu;
