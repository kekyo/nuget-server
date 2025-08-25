// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useEffect, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import {
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Alert,
  Chip,
  Box,
  Button,
  Paper,
  IconButton,
  Stack,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PackageIcon from '@mui/icons-material/Inventory';
import PackageSourceIcon from '@mui/icons-material/Source';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { EditNote } from '@mui/icons-material';

interface SearchResultVersion {
  version: string;
  downloads: number;
  '@id': string;
}

interface SearchResult {
  '@type': string;
  registration: string;
  id: string;
  version: string;
  description: string;
  summary: string;
  title: string;
  iconUrl?: string;
  licenseUrl?: string;
  license?: string;
  projectUrl?: string;
  tags: string[];
  authors: string[];
  totalDownloads: number;
  verified: boolean;
  packageTypes: Array<{
    name: string;
  }>;
  versions: SearchResultVersion[];
}

interface SearchResponse {
  '@context': {
    '@vocab': string;
    '@base': string;
  };
  totalHits: number;
  lastReopen: string;
  index: string;
  data: SearchResult[];
}

interface ServerConfig {
  realm: string;
  name: string;
  version: string;
  git_commit_hash: string;
  addSourceCommand: string;
  authMode: 'none' | 'publish' | 'full';
  authEnabled: {
    general: boolean;
    publish: boolean;
    admin: boolean;
  };
  currentUser?: {
    username: string;
    role: string;
    authenticated: boolean;
  } | null;
}

export interface PackageListRef {
  refresh: () => void;
}

interface PackageListProps {
  serverConfig?: ServerConfig | null;
}

// Component for displaying package icons with fallback
interface PackageIconDisplayProps {
  packageId: string;
  version: string;
}

const PackageIconDisplay: React.FC<PackageIconDisplayProps> = ({ packageId, version }) => {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const iconUrl = `/api/ui/icon/${packageId}/${version}`;
  
  const handleImageLoad = useCallback(() => {
    setIsLoading(false);
    setHasError(false);
  }, []);
  
  const handleImageError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
  }, []);
  
  if (hasError || !iconUrl) {
    return <PackageSourceIcon sx={{ height: 40, width: 40, mr: 2, color: 'text.secondary' }} />;
  }
  
  return (
    <Box sx={{ height: 40, width: 40, mr: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {isLoading && <PackageSourceIcon sx={{ height: 40, width: 40, color: 'text.secondary' }} />}
      <img 
        src={iconUrl}
        alt={`${packageId} icon`}
        style={{ 
          height: 40, 
          width: 40, 
          objectFit: 'contain',
          display: isLoading ? 'none' : 'block'
        }}
        onLoad={handleImageLoad}
        onError={handleImageError}
      />
    </Box>
  );
};

const PackageList = forwardRef<PackageListRef, PackageListProps>(({ serverConfig }, ref) => {
  const [packages, setPackages] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sortVersions = (versions: SearchResultVersion[]): SearchResultVersion[] => {
    return [...versions].sort((a, b) => {
      const parseVersion = (version: string) => {
        const [main, prerelease] = version.split('-');
        const parts = main.split('.').map(Number);
        return { parts, prerelease };
      };

      const versionA = parseVersion(a.version);
      const versionB = parseVersion(b.version);

      // Compare main version parts (major.minor.patch)
      for (let i = 0; i < Math.max(versionA.parts.length, versionB.parts.length); i++) {
        const partA = versionA.parts[i] || 0;
        const partB = versionB.parts[i] || 0;
        
        if (partA !== partB) {
          return partB - partA; // Descending order (latest first)
        }
      }

      // If main versions are equal, handle prerelease
      if (versionA.prerelease && !versionB.prerelease) return 1; // stable comes before prerelease
      if (!versionA.prerelease && versionB.prerelease) return -1; // stable comes before prerelease
      if (versionA.prerelease && versionB.prerelease) {
        return versionA.prerelease.localeCompare(versionB.prerelease); // alphabetical for prerelease
      }

      return 0;
    });
  };

  const fetchPackages = async () => {
    // Early return if serverConfig is not available
    if (!serverConfig) {
      setLoading(false);
      return;
    }
    
    // Skip API request if authMode=full and user is not authenticated
    if (serverConfig.authMode === 'full' && !serverConfig.currentUser?.authenticated) {
      // Don't set error when unauthenticated in authMode=full (login dialog will be shown)
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Use Fastify search endpoint
      const searchEndpoint = '/v3/search';
      
      const response = await fetch(searchEndpoint, {
        credentials: 'same-origin'
      });
      if (response.status === 401) {
        // Authentication required
        setError('Authentication required');
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: SearchResponse = await response.json();
      
      // Sort versions for each package
      const packagesWithSortedVersions = data.data.map(pkg => ({
        ...pkg,
        versions: sortVersions(pkg.versions)
      }));
      
      setPackages(packagesWithSortedVersions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Skip if serverConfig is not set
    if (!serverConfig) return;
    
    fetchPackages();
  }, [serverConfig]); // Add serverConfig to dependency array

  useImperativeHandle(ref, () => ({
    refresh: fetchPackages,
  }));

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  // Don't display anything when unauthenticated in authMode=full (login dialog will be shown)
  if (serverConfig?.authMode === 'full' && !serverConfig?.currentUser?.authenticated) {
    return null;
  }

  if (error) {
    return (
      <Alert severity="error">
        Error loading packages: {error}
      </Alert>
    );
  }

  if (packages.length === 0) {
    return (
      <Alert severity="info">
        No packages found in the repository.
      </Alert>
    );
  }

  const handleCopyCommand = () => {
    if (serverConfig?.addSourceCommand) {
      navigator.clipboard.writeText(serverConfig.addSourceCommand);
    }
  };

  return (
    <Box>
      {serverConfig?.addSourceCommand && (
        <Paper 
          sx={{ 
            p: 2, 
            mb: 3, 
            backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
            border: 1,
            borderColor: 'divider'
          }}
          elevation={0}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ flexGrow: 1 }}>
              <Stack direction="row">
                <EditNote fontSize="small" />
                <Typography variant="body2" color="text.secondary" gutterBottom marginLeft="0.3rem">
                  Add this server as a NuGet source:
                </Typography>
              </Stack>
              <Typography 
                variant="body2" marginLeft="0.5rem"
                sx={{ 
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  wordBreak: 'break-all'
                }}
              >
                `{serverConfig.addSourceCommand}`
              </Typography>
            </Box>
            <IconButton 
              size="small" 
              onClick={handleCopyCommand}
              aria-label="copy command"
              sx={{ ml: 1 }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Box>
        </Paper>
      )}

      <Typography variant="h4" component="h1" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <PackageIcon />
        Packages ({packages.length})
      </Typography>
      
      {packages.map((pkg) => (
        <Accordion key={pkg.id} sx={{ mb: 1 }}>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls={`panel-${pkg.id}-content`}
            id={`panel-${pkg.id}-header`}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <PackageIconDisplay packageId={pkg.id} version={pkg.version} />
              <Typography variant="h6" component="div">
                {pkg.id}
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box>
              {/* Package Description */}
              {pkg.description && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Description:
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {pkg.description}
                  </Typography>
                </Box>
              )}

              {/* Package Authors */}
              {pkg.authors.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Authors:
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {pkg.authors.join(', ')}
                  </Typography>
                </Box>
              )}

              {/* Package Tags */}
              {pkg.tags.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Tags:
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {pkg.tags.map((tag) => (
                      <Chip key={tag} label={tag} size="small" variant="outlined" />
                    ))}
                  </Box>
                </Box>
              )}

              {/* Package Links */}
              {(pkg.projectUrl || pkg.licenseUrl) && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Links:
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {pkg.projectUrl && (
                      <Chip
                        label="Project"
                        component="a"
                        href={pkg.projectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        clickable
                        size="small"
                        color="primary"
                      />
                    )}
                    {(pkg.licenseUrl || pkg.license) && (
                      <Chip
                        label={pkg.license ? `License: ${pkg.license}` : "License"}
                        component="a"
                        href={pkg.licenseUrl || (pkg.license ? `https://spdx.org/licenses/${pkg.license}` : undefined)}
                        target="_blank"
                        rel="noopener noreferrer"
                        clickable
                        size="small"
                        color="secondary"
                      />
                    )}
                  </Box>
                </Box>
              )}

              {/* Versions List */}
              <Typography variant="subtitle2" gutterBottom>
                Versions ({pkg.versions.length}):
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {pkg.versions.map((version) => (
                  <Button
                    key={version.version}
                    variant="outlined"
                    size="small"
                    startIcon={<DownloadIcon />}
                    onClick={() => {
                      const downloadUrl = `/v3/package/${pkg.id.toLowerCase()}/${version.version}/${pkg.id.toLowerCase()}.${version.version}.nupkg`;
                      window.open(downloadUrl, '_blank');
                    }}
                  >
                    {version.version}
                  </Button>
                ))}
              </Box>
            </Box>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
});

PackageList.displayName = 'PackageList';

export default PackageList;
