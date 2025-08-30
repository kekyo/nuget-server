// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import {
  useEffect,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useMemo,
} from "react";
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
  TextField,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PackageIcon from "@mui/icons-material/Inventory";
import PackageSourceIcon from "@mui/icons-material/Source";
import DownloadIcon from "@mui/icons-material/Download";
import InfiniteScroll from "react-infinite-scroll-component";
import { sortVersions } from "../utils/semver";
import { apiFetch } from "./utils/apiClient";

interface SearchResultVersion {
  version: string;
  downloads: number;
  "@id": string;
}

interface SearchResult {
  "@type": string;
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
  "@context": {
    "@vocab": string;
    "@base": string;
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
  serverUrl: {
    baseUrl?: string;
    port: number;
    isHttps: boolean;
  };
  authMode: "none" | "publish" | "full";
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

const PackageIconDisplay: React.FC<PackageIconDisplayProps> = ({
  packageId,
  version,
}) => {
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
    return (
      <PackageSourceIcon
        sx={{ height: 40, width: 40, mr: 2, color: "text.secondary" }}
      />
    );
  }

  return (
    <Box
      sx={{
        height: 40,
        width: 40,
        mr: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {isLoading && (
        <PackageSourceIcon
          sx={{ height: 40, width: 40, color: "text.secondary" }}
        />
      )}
      <img
        src={iconUrl}
        alt={`${packageId} icon`}
        style={{
          height: 40,
          width: 40,
          objectFit: "contain",
          display: isLoading ? "none" : "block",
        }}
        onLoad={handleImageLoad}
        onError={handleImageError}
      />
    </Box>
  );
};

const PackageList = forwardRef<PackageListRef, PackageListProps>(
  ({ serverConfig }, ref) => {
    const [packages, setPackages] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [page, setPage] = useState(0);
    const [totalHits, setTotalHits] = useState(0);
    const [expandedPanels, setExpandedPanels] = useState<Set<string>>(
      new Set(),
    );
    const [filterText, setFilterText] = useState("");
    const pageSize = 20;

    // Helper function to sort SearchResultVersion arrays using the shared semver logic
    const sortPackageVersions = (
      versions: SearchResultVersion[],
    ): SearchResultVersion[] => {
      const versionStrings = versions.map((v) => v.version);
      const sortedVersions = sortVersions(versionStrings, "desc"); // Descending order (newest first)

      // Re-map sorted versions back to SearchResultVersion objects
      return sortedVersions.map(
        (versionString) => versions.find((v) => v.version === versionString)!,
      );
    };

    const fetchPackages = async (isInitialLoad = true) => {
      // Early return if serverConfig is not available
      if (!serverConfig) {
        setLoading(false);
        return;
      }

      // Skip API request if authMode=full and user is not authenticated
      if (
        serverConfig.authMode === "full" &&
        !serverConfig.currentUser?.authenticated
      ) {
        // Don't set error when unauthenticated in authMode=full (login dialog will be shown)
        setLoading(false);
        return;
      }

      // Only set loading for initial load
      if (isInitialLoad) {
        setLoading(true);
        setError(null);
        setPackages([]);
        setPage(0);
        setHasMore(true);
      }

      try {
        // Calculate skip value based on current page
        const skip = isInitialLoad ? 0 : page * pageSize;

        // Use Fastify search endpoint with pagination
        const searchEndpoint = `v3/search?skip=${skip}&take=${pageSize}`;

        const response = await apiFetch(searchEndpoint, {
          credentials: "same-origin",
        });
        if (response.status === 401) {
          // Authentication required
          setError("Authentication required");
          return;
        }
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: SearchResponse = await response.json();

        // Sort versions for each package
        const packagesWithSortedVersions = data.data.map((pkg) => ({
          ...pkg,
          versions: sortPackageVersions(pkg.versions),
        }));

        // Sort packages alphabetically for consistent display
        const sortedPackages = packagesWithSortedVersions.sort((a, b) =>
          a.id.localeCompare(b.id, undefined, { sensitivity: "base" }),
        );

        if (isInitialLoad) {
          setPackages(sortedPackages);
        } else {
          // Append new packages to existing ones and re-sort
          setPackages((prevPackages) => {
            const combined = [...prevPackages, ...sortedPackages];
            // Re-sort the combined list to maintain alphabetical order
            return combined.sort((a, b) =>
              a.id.localeCompare(b.id, undefined, { sensitivity: "base" }),
            );
          });
        }

        // Update total hits and check if there are more packages
        setTotalHits(data.totalHits);

        // Check if we have loaded all packages
        const loadedCount = isInitialLoad
          ? packagesWithSortedVersions.length
          : packages.length + packagesWithSortedVersions.length;
        setHasMore(loadedCount < data.totalHits);

        // Increment page for next load
        if (!isInitialLoad) {
          setPage((prevPage) => prevPage + 1);
        } else {
          setPage(1); // Set to 1 after initial load
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error occurred");
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    };

    const loadMorePackages = () => {
      if (!loading) {
        fetchPackages(false);
      }
    };

    // Filter packages based on filter text
    const filteredPackages = useMemo(() => {
      if (!filterText.trim()) {
        return packages;
      }

      // Split filter text by space or comma and normalize
      const searchTerms = filterText
        .split(/[,\s]+/)
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length > 0);

      if (searchTerms.length === 0) {
        return packages;
      }

      return packages.filter((pkg) => {
        // Check if all search terms match at least one field
        return searchTerms.every((term) => {
          // Check package ID
          if (pkg.id.toLowerCase().includes(term)) {
            return true;
          }

          // Check description
          if (pkg.description && pkg.description.toLowerCase().includes(term)) {
            return true;
          }

          // Check tags
          if (pkg.tags.some((tag) => tag.toLowerCase().includes(term))) {
            return true;
          }

          // Check authors
          if (
            pkg.authors.some((author) => author.toLowerCase().includes(term))
          ) {
            return true;
          }

          // Check versions
          if (
            pkg.versions.some((version) =>
              version.version.toLowerCase().includes(term),
            )
          ) {
            return true;
          }

          return false;
        });
      });
    }, [packages, filterText]);

    const handleAccordionChange = useCallback(
      (packageId: string) =>
        (_event: React.SyntheticEvent, isExpanded: boolean) => {
          setExpandedPanels((prev) => {
            const newSet = new Set(prev);
            if (isExpanded) {
              newSet.add(packageId);
            } else {
              newSet.delete(packageId);
            }
            return newSet;
          });
        },
      [],
    );

    useEffect(() => {
      // Skip if serverConfig is not set
      if (!serverConfig) return;

      fetchPackages();
    }, [serverConfig]); // Add serverConfig to dependency array

    // Auto-load more packages when filtered results are below visible threshold
    useEffect(() => {
      // Skip if no filter is active or still loading
      if (!filterText || loading) return;

      // Check if we need to load more packages
      // Load more if filtered results are less than half the page size and we have more to load
      if (filteredPackages.length < pageSize / 2 && hasMore) {
        loadMorePackages();
      }
    }, [filteredPackages.length, filterText, loading, hasMore, pageSize]);

    useImperativeHandle(ref, () => ({
      refresh: () => fetchPackages(true),
    }));

    if (loading) {
      return (
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          minHeight="200px"
        >
          <CircularProgress />
        </Box>
      );
    }

    // Don't display anything when unauthenticated in authMode=full (login dialog will be shown)
    if (
      serverConfig?.authMode === "full" &&
      !serverConfig?.currentUser?.authenticated
    ) {
      return null;
    }

    if (error) {
      return <Alert severity="error">Error loading packages: {error}</Alert>;
    }

    if (packages.length === 0 && !filterText) {
      return (
        <Alert severity="info">No packages found in the repository.</Alert>
      );
    }

    return (
      <Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 2,
          }}
        >
          <Typography
            variant="h4"
            component="h1"
            sx={{ display: "flex", alignItems: "center", gap: 1 }}
          >
            <PackageIcon />
            Packages{" "}
            {filterText.trim() ? (
              <>
                ({filteredPackages.length}/
                {totalHits > 0 ? totalHits : packages.length})
              </>
            ) : (
              <>({totalHits > 0 ? totalHits : packages.length})</>
            )}
          </Typography>
          <TextField
            size="small"
            placeholder="Filter packages..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            sx={{ minWidth: 250 }}
          />
        </Box>

        {filteredPackages.length === 0 && filterText ? (
          <Alert severity="info">No packages match your filter criteria.</Alert>
        ) : (
          <InfiniteScroll
            dataLength={filteredPackages.length}
            next={loadMorePackages}
            hasMore={hasMore && !filterText}
            loader={
              <Box
                display="flex"
                justifyContent="center"
                alignItems="center"
                p={2}
              >
                <CircularProgress size={24} />
                <Typography variant="body2" sx={{ ml: 2 }}>
                  Loading more packages...
                </Typography>
              </Box>
            }
            endMessage={
              filteredPackages.length > 0 ? (
                <Typography
                  sx={{ textAlign: "center", p: 2, color: "text.secondary" }}
                >
                  {filterText
                    ? `Showing ${filteredPackages.length} of ${packages.length} packages`
                    : `All ${packages.length} packages loaded`}
                </Typography>
              ) : null
            }
            scrollThreshold={0.9}
          >
            {filteredPackages.map((pkg) => (
              <Accordion
                key={pkg.id}
                sx={{ mb: 1 }}
                expanded={expandedPanels.has(pkg.id)}
                onChange={handleAccordionChange(pkg.id)}
                TransitionProps={{ unmountOnExit: true }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  aria-controls={`panel-${pkg.id}-content`}
                  id={`panel-${pkg.id}-header`}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                    }}
                  >
                    <PackageIconDisplay
                      packageId={pkg.id}
                      version={pkg.version}
                    />
                    <Typography variant="h6" component="div">
                      {pkg.id}
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  {expandedPanels.has(pkg.id) && (
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
                            {pkg.authors.join(", ")}
                          </Typography>
                        </Box>
                      )}

                      {/* Package Tags */}
                      {pkg.tags.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                          <Typography variant="subtitle2" gutterBottom>
                            Tags:
                          </Typography>
                          <Box
                            sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}
                          >
                            {pkg.tags.map((tag) => (
                              <Chip
                                key={tag}
                                label={tag}
                                size="small"
                                variant="outlined"
                              />
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
                          <Box sx={{ display: "flex", gap: 1 }}>
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
                                label={
                                  pkg.license
                                    ? `License: ${pkg.license}`
                                    : "License"
                                }
                                component="a"
                                href={
                                  pkg.licenseUrl ||
                                  (pkg.license
                                    ? `https://spdx.org/licenses/${pkg.license}`
                                    : undefined)
                                }
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
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                        {pkg.versions.map((version) => (
                          <Button
                            key={version.version}
                            variant="outlined"
                            size="small"
                            startIcon={<DownloadIcon />}
                            onClick={() => {
                              const downloadUrl = `/v3/package/${pkg.id.toLowerCase()}/${version.version}/${pkg.id.toLowerCase()}.${version.version}.nupkg`;
                              window.open(downloadUrl, "_blank");
                            }}
                          >
                            {version.version}
                          </Button>
                        ))}
                      </Box>
                    </Box>
                  )}
                </AccordionDetails>
              </Accordion>
            ))}
          </InfiniteScroll>
        )}
      </Box>
    );
  },
);

PackageList.displayName = "PackageList";

export default PackageList;
