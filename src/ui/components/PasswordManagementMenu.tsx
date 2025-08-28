// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState } from "react";
import {
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import {
  Lock as LockIcon,
  LockReset as LockResetIcon,
  VpnKey as VpnKeyIcon,
  ArrowDropDown as ArrowDropDownIcon,
} from "@mui/icons-material";

interface PasswordManagementMenuProps {
  onChangePassword: () => void;
  onApiPassword: () => void;
}

const PasswordManagementMenu = ({
  onChangePassword,
  onApiPassword,
}: PasswordManagementMenuProps) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleChangePassword = () => {
    handleClose();
    onChangePassword();
  };

  const handleApiPassword = () => {
    handleClose();
    onApiPassword();
  };

  return (
    <>
      <Button
        color="inherit"
        startIcon={<LockIcon />}
        endIcon={<ArrowDropDownIcon />}
        onClick={handleClick}
        sx={{ mr: 1 }}
      >
        Password
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
      >
        <MenuItem onClick={handleChangePassword}>
          <ListItemIcon>
            <LockResetIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Change Password</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleApiPassword}>
          <ListItemIcon>
            <VpnKeyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>API Password</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
};

export default PasswordManagementMenu;
