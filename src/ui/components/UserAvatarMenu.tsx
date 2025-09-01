// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState } from "react";
import { TypedMessage } from "typed-message";
import { messages } from "../../generated/messages";
import {
  Avatar,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  IconButton,
  ListSubheader,
} from "@mui/material";
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
} from "@mui/icons-material";

interface UserAvatarMenuProps {
  username?: string | null;
  authMode?: "none" | "publish" | "full";
  isAuthenticated: boolean;
  isAdmin: boolean;
  canManagePassword: boolean;
  showLogin: boolean;
  currentLocale: string;
  availableLanguages: string[];
  languageNames: Record<string, string>;
  onLogin: () => void;
  onAddUser: () => void;
  onResetPassword: () => void;
  onDeleteUser: () => void;
  onChangePassword: () => void;
  onApiPassword: () => void;
  onLogout: () => void;
  onLanguageChange: (code: string) => void;
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
  onLogin,
  onAddUser,
  onResetPassword,
  onDeleteUser,
  onChangePassword,
  onApiPassword,
  onLogout,
  onLanguageChange,
}: UserAvatarMenuProps) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [languageAnchorEl, setLanguageAnchorEl] = useState<null | HTMLElement>(
    null,
  );
  const open = Boolean(anchorEl);
  const languageMenuOpen = Boolean(languageAnchorEl);

  // Get first letter of username for avatar
  const getAvatarLetter = () => {
    if (username) {
      return username.charAt(0).toUpperCase();
    }
    return "A"; // Default for admin when auth is disabled
  };

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
    setLanguageAnchorEl(null);
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
        aria-controls={open ? "user-avatar-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
      >
        <Avatar
          sx={{
            width: 32,
            height: 32,
            bgcolor: "primary.main",
            fontSize: "1rem",
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
          "aria-labelledby": "user-avatar-button",
        }}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        PaperProps={{
          elevation: 0,
          sx: {
            overflow: "visible",
            filter: "drop-shadow(0px 2px 8px rgba(0,0,0,0.32))",
            mt: 1.5,
            "& .MuiAvatar-root": {
              width: 32,
              height: 32,
              ml: -0.5,
              mr: 1,
            },
            "&:before": {
              content: '""',
              display: "block",
              position: "absolute",
              top: 0,
              right: 14,
              width: 10,
              height: 10,
              bgcolor: "background.paper",
              transform: "translateY(-50%) rotate(45deg)",
              zIndex: 0,
            },
          },
        }}
      >
        {/* Determine what to show based on authMode */}
        {authMode === "none" ? (
          // For authMode=none, show empty menu
          <MenuItem disabled>
            <ListItemText
              primary="No menu items available"
              primaryTypographyProps={{
                fontStyle: "italic",
                color: "text.secondary",
              }}
            />
          </MenuItem>
        ) : (
          <>
            {/* User info at the top */}
            {username && (
              <>
                <MenuItem disabled>
                  <ListItemText
                    primary={username}
                    primaryTypographyProps={{
                      fontWeight: "medium",
                    }}
                  />
                </MenuItem>
                <Divider />
              </>
            )}

            {/* User Management (Admin only) */}
            {isAdmin && isAuthenticated && (
              <>
                <ListSubheader>
                  <TypedMessage message={messages.USERS} />
                </ListSubheader>
                <MenuItem onClick={() => handleAction(onAddUser)}>
                  <ListItemIcon>
                    <PersonAddIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>
                    <TypedMessage message={messages.ADD_USER} />
                  </ListItemText>
                </MenuItem>
                <MenuItem onClick={() => handleAction(onResetPassword)}>
                  <ListItemIcon>
                    <LockResetIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>
                    <TypedMessage message={messages.RESET_PASSWORD} />
                  </ListItemText>
                </MenuItem>
                <MenuItem onClick={() => handleAction(onDeleteUser)}>
                  <ListItemIcon>
                    <PersonRemoveIcon fontSize="small" color="error" />
                  </ListItemIcon>
                  <ListItemText>
                    <TypedMessage message={messages.DELETE_USER} />
                  </ListItemText>
                </MenuItem>
                <Divider />
              </>
            )}

            {/* Password Management */}
            {canManagePassword && isAuthenticated && (
              <>
                <ListSubheader>
                  <TypedMessage message={messages.PASSWORD_MENU} />
                </ListSubheader>
                <MenuItem onClick={() => handleAction(onChangePassword)}>
                  <ListItemIcon>
                    <LockResetIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>
                    <TypedMessage message={messages.CHANGE_PASSWORD} />
                  </ListItemText>
                </MenuItem>
                <MenuItem onClick={() => handleAction(onApiPassword)}>
                  <ListItemIcon>
                    <VpnKeyIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>
                    <TypedMessage message={messages.API_PASSWORD} />
                  </ListItemText>
                </MenuItem>
                <Divider />
              </>
            )}

            {/* Language Selection */}
            <ListSubheader>
              <TypedMessage message={messages.LANGUAGE} />
            </ListSubheader>
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
                {(() => {
                  const savedLocale = localStorage.getItem("preferredLocale");
                  const isAutoMode = !savedLocale || savedLocale === "auto";
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
            <Divider />

            {/* Logout - Only show when authenticated */}
            {isAuthenticated && (
              <MenuItem onClick={() => handleAction(onLogout)}>
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>
                  <TypedMessage message={messages.LOGOUT} />
                </ListItemText>
              </MenuItem>
            )}

            {/* Login button when not authenticated */}
            {showLogin && !isAuthenticated && (
              <MenuItem onClick={() => handleAction(onLogin)}>
                <ListItemIcon>
                  <LoginIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>
                  <TypedMessage message={messages.LOGIN} />
                </ListItemText>
              </MenuItem>
            )}
          </>
        )}
      </Menu>

      {/* Language Submenu */}
      <Menu
        anchorEl={languageAnchorEl}
        open={languageMenuOpen}
        onClose={() => setLanguageAnchorEl(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        {/* Auto option */}
        <MenuItem
          onClick={() => {
            handleAction(() => onLanguageChange("auto"));
            setLanguageAnchorEl(null);
          }}
        >
          <ListItemIcon>
            {(!localStorage.getItem("preferredLocale") ||
              localStorage.getItem("preferredLocale") === "auto") && (
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
              {localStorage.getItem("preferredLocale") === lang && (
                <CheckIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText>
              {languageNames[lang] || lang.toUpperCase()}
            </ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

export default UserAvatarMenu;
