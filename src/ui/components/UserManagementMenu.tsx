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
  Divider,
} from "@mui/material";
import {
  Group as GroupIcon,
  PersonAdd as PersonAddIcon,
  LockReset as LockResetIcon,
  PersonRemove as PersonRemoveIcon,
  ArrowDropDown as ArrowDropDownIcon,
} from "@mui/icons-material";

interface UserManagementMenuProps {
  onAddUser: () => void;
  onResetPassword: () => void;
  onDeleteUser: () => void;
}

const UserManagementMenu = ({
  onAddUser,
  onResetPassword,
  onDeleteUser,
}: UserManagementMenuProps) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleAddUser = () => {
    handleClose();
    onAddUser();
  };

  const handleResetPassword = () => {
    handleClose();
    onResetPassword();
  };

  const handleDeleteUser = () => {
    handleClose();
    onDeleteUser();
  };

  return (
    <>
      <Button
        color="inherit"
        startIcon={<GroupIcon />}
        endIcon={<ArrowDropDownIcon />}
        onClick={handleClick}
        sx={{ mr: 1 }}
        aria-controls={open ? "user-management-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
      >
        Users
      </Button>
      <Menu
        id="user-management-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          "aria-labelledby": "user-management-button",
        }}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "left",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "left",
        }}
      >
        <MenuItem onClick={handleAddUser}>
          <ListItemIcon>
            <PersonAddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Add User</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleResetPassword}>
          <ListItemIcon>
            <LockResetIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Reset Password</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleDeleteUser}>
          <ListItemIcon>
            <PersonRemoveIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Delete User</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
};

export default UserManagementMenu;
