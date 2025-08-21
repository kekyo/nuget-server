// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { useEffect, useState } from 'react';
import {
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Alert,
  Chip,
  Box,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PackageIcon from '@mui/icons-material/Inventory';

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

const PackageList = () => {
  const [packages, setPackages] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPackages = async () => {
      try {
        const response = await fetch('/api/search');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: SearchResponse = await response.json();
        setPackages(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchPackages();
  }, []);

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
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h6" component="div">
                {pkg.id}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {pkg.description || 'No description available'}
              </Typography>
              {pkg.authors.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  Authors: {pkg.authors.join(', ')}
                </Typography>
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box>
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
              <List dense>
                {pkg.versions.map((version) => (
                  <ListItem key={version.version} sx={{ pl: 0 }}>
                    <ListItemText
                      primary={version.version}
                      secondary={`Downloads: ${version.downloads.toLocaleString()}`}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
};

export default PackageList;