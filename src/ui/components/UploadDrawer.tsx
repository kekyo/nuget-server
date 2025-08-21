// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState } from 'react';
import {
  Drawer,
  Box,
  Typography,
  Button,
  TextField,
  Alert,
  CircularProgress,
  IconButton,
  Divider,
  Paper,
} from '@mui/material';
import {
  Close as CloseIcon,
  CloudUpload as UploadIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';

interface UploadDrawerProps {
  open: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
}

interface UploadResult {
  success: boolean;
  packageName?: string;
  version?: string;
  message?: string;
}

const UploadDrawer = ({ open, onClose, onUploadSuccess }: UploadDrawerProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.endsWith('.nupkg')) {
      setSelectedFile(file);
    } else {
      alert('Please select a .nupkg file');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setResult(null);

    try {
      // Read file as ArrayBuffer to send as binary data
      const fileBuffer = await selectedFile.arrayBuffer();

      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: fileBuffer,
      });

      if (response.ok) {
        const responseText = await response.text();
        setResult({
          success: true,
          packageName: selectedFile.name.replace('.nupkg', ''),
          message: 'Package uploaded successfully',
        });
        onUploadSuccess();
      } else {
        const errorText = await response.text();
        setResult({
          success: false,
          message: `Upload failed: ${response.status} ${response.statusText}\n${errorText}`,
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: `Upload error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setUploading(false);
    setResult(null);
    onClose();
  };

  const resetForm = () => {
    setSelectedFile(null);
    setResult(null);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      variant="persistent"
      sx={{
        width: 400,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: 400,
          boxSizing: 'border-box',
        },
      }}
    >
      <Box sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h6" component="h2">
            Upload Package
          </Typography>
          <IconButton onClick={handleClose} edge="end">
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ mb: 3 }} />

        {!result ? (
          <Box>
            <Typography variant="body1" sx={{ mb: 2 }}>
              Select a NuGet package (.nupkg) file to upload:
            </Typography>

            <TextField
              type="file"
              fullWidth
              variant="outlined"
              inputProps={{
                accept: '.nupkg',
              }}
              onChange={handleFileChange}
              sx={{ mb: 3 }}
            />

            {selectedFile && (
              <Paper sx={{ p: 2, mb: 3, bgcolor: 'grey.50' }}>
                <Typography variant="body2" color="text.secondary">
                  Selected file:
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                  {selectedFile.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </Typography>
              </Paper>
            )}

            <Button
              variant="contained"
              fullWidth
              startIcon={uploading ? <CircularProgress size={20} /> : <UploadIcon />}
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              sx={{ mb: 2 }}
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </Box>
        ) : (
          <Box>
            <Alert
              severity={result.success ? 'success' : 'error'}
              icon={result.success ? <SuccessIcon /> : <ErrorIcon />}
              sx={{ mb: 3 }}
            >
              {result.success ? 'Upload Successful!' : 'Upload Failed'}
            </Alert>

            {result.success && result.packageName && (
              <Paper sx={{ p: 2, mb: 3, bgcolor: 'success.50' }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Package Details:
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                  {result.packageName}
                </Typography>
                {result.version && (
                  <Typography variant="body2" color="text.secondary">
                    Version: {result.version}
                  </Typography>
                )}
              </Paper>
            )}

            {result.message && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Details:
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    bgcolor: 'grey.100',
                    p: 1,
                    borderRadius: 1,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {result.message}
                </Typography>
              </Box>
            )}

            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                onClick={resetForm}
                sx={{ flex: 1 }}
              >
                Upload Another
              </Button>
              <Button
                variant="contained"
                onClick={handleClose}
                sx={{ flex: 1 }}
              >
                Close
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

export default UploadDrawer;