// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useState, useRef } from "react";
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
} from "@mui/material";
import {
  Close as CloseIcon,
  CloudUpload as UploadIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  FileUpload as FileUploadIcon,
  Clear as ClearIcon,
} from "@mui/icons-material";
import {
  Chip,
  LinearProgress,
  List,
  ListItemIcon,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Stack,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

interface UploadDrawerProps {
  open: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
}

interface UploadResult {
  fileName: string;
  success: boolean;
  packageName?: string;
  version?: string;
  message?: string;
  status: "pending" | "uploading" | "success" | "error";
}

const UploadDrawer = ({
  open,
  onClose,
  onUploadSuccess,
}: UploadDrawerProps) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [currentUploadIndex, setCurrentUploadIndex] = useState<number>(-1);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const hasTriggeredAuthReload = useRef(false);

  const handleFileSelection = (files: File[]) => {
    const validFiles = files.filter((file) => file.name.endsWith(".nupkg"));
    const invalidCount = files.length - validFiles.length;

    if (invalidCount > 0) {
      alert(`${invalidCount} file(s) were not .nupkg files and were excluded.`);
    }

    if (validFiles.length > 0) {
      setSelectedFiles(validFiles);
      setUploadResults([]);
      setCurrentUploadIndex(-1);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      handleFileSelection(Array.from(files));
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    hasTriggeredAuthReload.current = false;
    const results: UploadResult[] = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      if (!file) continue;

      setCurrentUploadIndex(i);

      const result: UploadResult = {
        fileName: file.name,
        success: false,
        status: "uploading",
        packageName: file.name.replace(".nupkg", ""),
      };

      try {
        // Update status for current file
        setUploadResults([...results, result]);

        // Read file as ArrayBuffer to send as binary data
        const fileBuffer = await file.arrayBuffer();

        const response = await fetch("/api/publish", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          body: fileBuffer,
          credentials: "same-origin",
        });

        if (response.ok) {
          const apiResult = await response.json();
          result.success = true;
          result.status = "success";
          result.version = apiResult.version;
          result.message = `${apiResult.message}\nResolved: ${apiResult.id} ${apiResult.version}`;
        } else if (response.status === 401 && !hasTriggeredAuthReload.current) {
          // Authentication required - reload to trigger browser's Basic auth popup (only once)
          hasTriggeredAuthReload.current = true;
          window.location.reload();
          return;
        } else {
          const errorText = await response.text();
          result.status = "error";
          result.message = `Upload failed: ${response.status} ${response.statusText}\n${errorText}`;
        }
      } catch (error) {
        result.status = "error";
        result.message = `Upload error: ${error instanceof Error ? error.message : "Unknown error"}`;
      }

      results.push(result);
      setUploadResults([...results]);
    }

    setUploading(false);
    setCurrentUploadIndex(-1);

    // Call success callback if at least one upload succeeded
    if (results.some((r) => r.success)) {
      onUploadSuccess();
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
    if (files && files.length > 0) {
      handleFileSelection(Array.from(files));
    }
  };

  const handleClose = () => {
    setSelectedFiles([]);
    setUploading(false);
    setUploadResults([]);
    setCurrentUploadIndex(-1);
    setIsDragging(false);
    dragCounter.current = 0;
    hasTriggeredAuthReload.current = false;
    onClose();
  };

  const resetForm = () => {
    setSelectedFiles([]);
    setUploadResults([]);
    setCurrentUploadIndex(-1);
  };

  const removeFile = (index: number) => {
    setSelectedFiles((files) => files.filter((_, i) => i !== index));
  };

  const getTotalSize = () => {
    return selectedFiles.reduce((total, file) => total + file.size, 0);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      variant="temporary"
      sx={{
        width: 400,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: 400,
          boxSizing: "border-box",
        },
      }}
    >
      <Box
        sx={{ p: 3, height: "100%" }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 3,
          }}
        >
          <Typography variant="h6" component="h2">
            Upload Package
          </Typography>
          <IconButton onClick={handleClose} edge="end">
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ mb: 3 }} />

        {uploadResults.length === 0 ? (
          <Box>
            <Typography variant="body1" sx={{ mb: 2 }}>
              Select NuGet package (.nupkg) files to upload:
            </Typography>

            <Paper
              sx={{
                p: 4,
                mb: 3,
                textAlign: "center",
                border: isDragging ? "2px dashed #2196f3" : "2px dashed #ccc",
                backgroundColor: isDragging
                  ? (theme) =>
                      theme.palette.mode === "dark"
                        ? "rgba(33, 150, 243, 0.1)"
                        : "rgba(33, 150, 243, 0.05)"
                  : "transparent",
                cursor: "pointer",
                transition: "all 0.3s ease",
                "&:hover": {
                  backgroundColor: (theme) =>
                    theme.palette.mode === "dark"
                      ? "rgba(255, 255, 255, 0.05)"
                      : "rgba(0, 0, 0, 0.02)",
                  borderColor: "#999",
                },
              }}
              variant="outlined"
              elevation={0}
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <FileUploadIcon
                sx={{
                  fontSize: 48,
                  color: isDragging ? "#2196f3" : "text.secondary",
                  mb: 2,
                  transition: "color 0.3s ease",
                }}
              />

              {isDragging ? (
                <Typography variant="h6" color="primary" sx={{ mb: 1 }}>
                  Drop your .nupkg files here
                </Typography>
              ) : (
                <>
                  <Typography variant="h6" color="text.primary" sx={{ mb: 1 }}>
                    Drag & drop your .nupkg files here
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
                accept: ".nupkg",
                multiple: true,
              }}
              onChange={handleFileChange}
              sx={{ display: "none" }}
            />

            {selectedFiles.length > 0 && (
              <Paper sx={{ p: 2, mb: 3 }} variant="outlined" elevation={0}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  Selected files ({selectedFiles.length} file
                  {selectedFiles.length !== 1 ? "s" : ""},{" "}
                  {(getTotalSize() / 1024 / 1024).toFixed(2)} MB total):
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {selectedFiles.map((file, index) => (
                    <Chip
                      key={index}
                      label={file.name}
                      onDelete={() => removeFile(index)}
                      deleteIcon={<ClearIcon />}
                      size="small"
                      sx={{ mb: 1 }}
                    />
                  ))}
                </Stack>
              </Paper>
            )}

            {uploading && currentUploadIndex >= 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  Uploading {currentUploadIndex + 1} of {selectedFiles.length}:{" "}
                  {selectedFiles[currentUploadIndex]?.name || ""}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={(currentUploadIndex / selectedFiles.length) * 100}
                />
              </Box>
            )}

            <Button
              variant="contained"
              fullWidth
              startIcon={
                uploading ? <CircularProgress size={20} /> : <UploadIcon />
              }
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || uploading}
              sx={{ mb: 2 }}
            >
              {uploading
                ? `Uploading (${currentUploadIndex + 1}/${selectedFiles.length})...`
                : `Upload ${selectedFiles.length} file${selectedFiles.length !== 1 ? "s" : ""}`}
            </Button>
          </Box>
        ) : (
          <Box>
            {/* Summary */}
            <Box sx={{ mb: 3 }}>
              {uploadResults.filter((r) => r.status === "success").length ===
              uploadResults.length ? (
                <Alert severity="success" icon={<SuccessIcon />}>
                  All {uploadResults.length} package
                  {uploadResults.length !== 1 ? "s" : ""} uploaded successfully!
                </Alert>
              ) : uploadResults.filter((r) => r.status === "error").length ===
                uploadResults.length ? (
                <Alert severity="error" icon={<ErrorIcon />}>
                  All uploads failed
                </Alert>
              ) : (
                <Alert severity="warning">
                  {uploadResults.filter((r) => r.status === "success").length}{" "}
                  of {uploadResults.length} package
                  {uploadResults.length !== 1 ? "s" : ""} uploaded successfully
                </Alert>
              )}
            </Box>

            {/* Results List */}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Upload Results:
            </Typography>

            <List sx={{ mb: 3 }}>
              {uploadResults.map((result, index) => (
                <Accordion
                  key={index}
                  defaultExpanded={result.status === "error"}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      {result.status === "success" ? (
                        <SuccessIcon color="success" />
                      ) : result.status === "error" ? (
                        <ErrorIcon color="error" />
                      ) : result.status === "uploading" ? (
                        <CircularProgress size={20} />
                      ) : null}
                    </ListItemIcon>
                    <Typography sx={{ flexGrow: 1 }}>
                      {result.fileName}
                    </Typography>
                    {result.version && (
                      <Typography variant="caption" color="text.secondary">
                        v{result.version}
                      </Typography>
                    )}
                  </AccordionSummary>
                  {result.message && (
                    <AccordionDetails>
                      <Paper
                        sx={{
                          p: 1,
                          borderRadius: 1,
                          backgroundColor: (theme) =>
                            theme.palette.mode === "dark"
                              ? "rgba(255, 255, 255, 0.05)"
                              : "rgba(0, 0, 0, 0.02)",
                        }}
                        variant="outlined"
                        elevation={0}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: "monospace",
                            fontSize: "0.75rem",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {result.message}
                        </Typography>
                      </Paper>
                    </AccordionDetails>
                  )}
                </Accordion>
              ))}
            </List>

            <Box sx={{ display: "flex", gap: 1 }}>
              <Button variant="outlined" onClick={resetForm} sx={{ flex: 1 }}>
                Upload More
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

export default UploadDrawer;
