// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useEffect, useState, useImperativeHandle, forwardRef } from 'react';
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
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PackageIcon from '@mui/icons-material/Inventory';
import DownloadIcon from '@mui/icons-material/Download';

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

export interface PackageListRef {
  refresh: () => void;
}

const PackageList = forwardRef<PackageListRef>((props, ref) => {
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
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/search');
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
    fetchPackages();
  }, []);

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

  return (
    <Box>
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
            <Typography variant="h6" component="div">
              {pkg.id}
            </Typography>
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
                    {pkg.licenseUrl && (
                      <Chip
                        label="License"
                        component="a"
                        href={pkg.licenseUrl}
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
                      const downloadUrl = `/api/package/${pkg.id.toLowerCase()}/${version.version}/${pkg.id.toLowerCase()}.${version.version}.nupkg`;
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
