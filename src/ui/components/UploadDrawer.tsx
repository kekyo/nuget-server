// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState, useRef } from 'react';
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
  FileUpload as FileUploadIcon,
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
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleFileSelection = (file: File) => {
    if (file && file.name.endsWith('.nupkg')) {
      setSelectedFile(file);
    } else {
      alert('Please select a .nupkg file');
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileSelection(file);
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
        const result = await response.json();
        setResult({
          success: true,
          packageName: selectedFile.name.replace('.nupkg', ''),
          message: `${result.message}\nResolved: ${result.id} ${result.version}`,
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

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    
    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFileSelection(files[0]);
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setUploading(false);
    setResult(null);
    setIsDragging(false);
    dragCounter.current = 0;
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
      <Box 
        sx={{ p: 3, height: '100%' }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
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

            <Paper
              sx={{
                p: 4,
                mb: 3,
                textAlign: 'center',
                border: isDragging ? '2px dashed #2196f3' : '2px dashed #ccc',
                backgroundColor: isDragging 
                  ? (theme) => theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.1)' : 'rgba(33, 150, 243, 0.05)' 
                  : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                '&:hover': {
                  backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)',
                  borderColor: '#999',
                },
              }}
              variant="outlined"
              elevation={0}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <FileUploadIcon 
                sx={{ 
                  fontSize: 48, 
                  color: isDragging ? '#2196f3' : 'text.secondary',
                  mb: 2,
                  transition: 'color 0.3s ease'
                }} 
              />
              
              {isDragging ? (
                <Typography variant="h6" color="primary" sx={{ mb: 1 }}>
                  Drop your .nupkg file here
                </Typography>
              ) : (
                <>
                  <Typography variant="h6" color="text.primary" sx={{ mb: 1 }}>
                    Drag & drop your .nupkg file here
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    or click to browse files
                  </Typography>
                </>
              )}
            </Paper>

            <TextField
              id="file-input"
              type="file"
              fullWidth
              variant="outlined"
              inputProps={{
                accept: '.nupkg',
              }}
              onChange={handleFileChange}
              sx={{ display: 'none' }}
            />

            {selectedFile && (
              <Paper sx={{ p: 2, mb: 3 }} variant="outlined" elevation={0}>
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
              <Paper sx={{ p: 2, mb: 3 }} variant="outlined" elevation={0}>
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
                <Paper
                  sx={{
                    p: 1,
                    borderRadius: 1,
                  }}
                  variant="outlined"
                  elevation={0}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {result.message}
                  </Typography>
                </Paper>
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
            </Box>
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

export default UploadDrawer;