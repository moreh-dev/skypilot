'use client';

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import PropTypes from 'prop-types';
import { CircularProgress } from '@mui/material';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getUsers } from '@/data/connectors/users';
import { getClusterHistory, getClusters } from '@/data/connectors/clusters';
import { getManagedJobs } from '@/data/connectors/jobs';
import dashboardCache from '@/lib/cache';
import cachePreloader from '@/lib/cache-preloader';
import { sortData } from '@/data/utils';
import { TimestampWithTooltip } from '@/components/utils';
import { RotateCwIcon, ExternalLink } from 'lucide-react';
import { useMobile } from '@/hooks/useMobile';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/data/connectors/client';
import { ErrorDisplay } from '@/components/elements/ErrorDisplay';
import { updateFiltersByURLParams as sharedUpdateFiltersByURLParams } from '@/components/shared/FilterSystem';
import {
  generateMonthlyReportData,
  aggregateMonthlyReport,
  clearPrometheusCache,
} from '@/utils/monthlyReportData';
import {
  analyzeUserArchetypes,
  generateUserGuidelines,
  generatePlatformImprovements,
  getArchetypeExplanation,
  USER_ARCHETYPES,
  ARCHETYPE_NAMES,
  ARCHETYPE_DESCRIPTIONS,
} from '@/utils/userArchetypeAnalysis';
import { NonCapitalizedTooltip } from '@/components/utils';
import { cn } from '@/lib/utils';

// Success display component
const SuccessDisplay = ({ message, onDismiss }) => {
  if (!message) return null;

  return (
    <div className="bg-green-50 border border-green-200 rounded p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-green-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium text-green-800">{message}</p>
          </div>
        </div>
        {onDismiss && (
          <div className="ml-auto pl-3">
            <div className="-mx-1.5 -my-1.5">
              <button
                type="button"
                onClick={onDismiss}
                className="inline-flex rounded-md bg-green-50 p-1.5 text-green-500 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 focus:ring-offset-green-50"
              >
                <span className="sr-only">Dismiss</span>
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export function Report() {
  const [loading, setLoading] = useState(true);
  const refreshDataRef = useRef(null);
  const isMobile = useMobile();
  const [userRoleCache, setUserRoleCache] = useState(null);
  const [createSuccess, setCreateSuccess] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [healthCheckLoading, setHealthCheckLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState('monthly'); // 'monthly', 'archetypes'
  const [monthlyReportData, setMonthlyReportData] = useState([]);
  const [userArchetypes, setUserArchetypes] = useState({});
  const [aggregatedStats, setAggregatedStats] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [clusters, setClusters] = useState([]);
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    async function fetchHealth() {
      setHealthCheckLoading(true);
      try {
        const resp = await apiClient.get('/api/health');
        if (resp.ok) {
          await resp.json();
        }
      } catch {
        // Ignore health check errors
      } finally {
        setHealthCheckLoading(false);
      }
    }
    fetchHealth();
  }, []);

  useEffect(() => {
    const fetchClusterData = async () => {
      try {
        const activeClusters = await dashboardCache.get(getClusters);
        const historyClusters = await dashboardCache.get(getClusterHistory, [
          null,
          30,
        ]);

        const markedActiveClusters = activeClusters.map((cluster) => ({
          ...cluster,
          isHistorical: false,
        }));
        const markedHistoryClusters = historyClusters.map((cluster) => ({
          ...cluster,
          isHistorical: true,
        }));

        const combinedData = [...markedActiveClusters];
        markedHistoryClusters.forEach((histCluster) => {
          const existsInActive = activeClusters.some(
            (activeCluster) =>
              activeCluster.cluster_hash === histCluster.cluster_hash
          );
          if (!existsInActive) {
            combinedData.push(histCluster);
          }
        });

        setClusters(combinedData);
      } catch (error) {
        console.error('Error fetching cluster data:', error);
        setClusters([]);
      }
    };

    const fetchJobsData = async () => {
      try {
        const jobsResponse = await dashboardCache.get(getManagedJobs, [
          { allUsers: true, skipFinished: false },
        ]);
        setJobs(jobsResponse?.jobs || []);
      } catch (error) {
        console.error('Error fetching jobs data:', error);
        setJobs([]);
      }
    };

    const fetchData = async () => {
      // Trigger cache preloading for clusters page and background preload other pages
      await cachePreloader.preloadForPage('report');

      await Promise.all([fetchClusterData(), fetchJobsData()]);
    };

    fetchData();
  }, []);

  // Generate monthly report data and analyze user patterns
  useEffect(() => {
    const fetchMonthlyData = async () => {
      if (clusters.length > 0 || jobs.length > 0) {
        setLoading(true);

        try {
          const monthlyData = await generateMonthlyReportData(
            clusters,
            selectedMonth,
            jobs
          );
          setMonthlyReportData(monthlyData);

          // Calculate aggregated statistics
          const aggregated = aggregateMonthlyReport(monthlyData);
          setAggregatedStats(aggregated);

          // Analyze user patterns
          const userArchetypesResult = analyzeUserArchetypes(monthlyData);
          setUserArchetypes(userArchetypesResult);
        } catch (error) {
          console.error('Error generating monthly report data:', error);
          // Fallback to empty data on error
          setMonthlyReportData([]);
          setAggregatedStats(null);
          setUserArchetypes({});
        }

        setLoading(false);
      }
    };

    fetchMonthlyData();
  }, [clusters, jobs, selectedMonth]);

  const getUserRole = useCallback(async () => {
    if (userRoleCache && Date.now() - userRoleCache.timestamp < 5 * 60 * 1000) {
      return userRoleCache;
    }

    const response = await apiClient.get(`/users/role`);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Failed to get user role');
    }
    const data = await response.json();
    const roleData = {
      role: data.role,
      name: data.name,
      id: data.id,
      timestamp: Date.now(),
    };
    setUserRoleCache(roleData);
    return roleData;
  }, [userRoleCache]);

  useEffect(() => {
    getUserRole().catch(() => {
      console.error('Failed to get user role');
    });
  }, [getUserRole]);

  const handleRefresh = () => {
    // Clear Prometheus cache to force fresh data fetch
    clearPrometheusCache();

    dashboardCache.invalidate(getUsers);
    dashboardCache.invalidate(getClusters);
    dashboardCache.invalidate(getClusterHistory);

    if (refreshDataRef.current) {
      refreshDataRef.current();
    }
  };

  // Show loading while fetching health check
  if (healthCheckLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <CircularProgress />
        <span className="ml-2 text-gray-500">Loading...</span>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-base flex items-center">
          <span className="text-sky-blue leading-none">Report</span>
          <div className="ml-4 flex items-center">
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm"
            />
          </div>
        </div>
        <div className="flex items-center">
          {loading && (
            <div className="flex items-center mr-2">
              <CircularProgress size={15} className="mt-0" />
              <span className="ml-2 text-gray-500 text-xs">Refreshing...</span>
            </div>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="text-sky-blue hover:text-sky-blue-bright flex items-center"
          >
            <RotateCwIcon className="h-4 w-4 mr-1.5" />
            {!isMobile && <span>Refresh</span>}
          </button>
        </div>
      </div>
      {/* Sub Tabs for Report Types */}
      <div className="flex space-x-1 my-4">
        <button
          onClick={() => setActiveSubTab('monthly')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeSubTab === 'monthly'
              ? 'bg-blue-100 text-blue-700 border-blue-300'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          Monthly GPU Usage Report
        </button>
        <button
          onClick={() => setActiveSubTab('archetypes')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeSubTab === 'archetypes'
              ? 'bg-blue-100 text-blue-700 border-blue-300'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          User Pattern Analysis
        </button>
      </div>

      {/* Error/Success messages positioned at top right, below navigation bar */}
      <div className="fixed top-20 right-4 z-[9999] max-w-md">
        <SuccessDisplay
          message={createSuccess}
          onDismiss={() => setCreateSuccess(null)}
        />
        <ErrorDisplay
          error={createError}
          title="Error"
          onDismiss={() => setCreateError(null)}
        />
      </div>

      {activeSubTab === 'monthly' && (
        <MonthlyReportView
          monthlyData={monthlyReportData}
          isLoading={loading}
        />
      )}
      {activeSubTab === 'archetypes' && (
        <UserArchetypesView
          userArchetypes={userArchetypes}
          aggregatedStats={aggregatedStats}
          isLoading={loading}
        />
      )}
    </>
  );
}

function ReportCard({
  data,
  isLoading,
  requestSort,
  getSortDirection,
  totalData,
  currentPage,
  pageSize,
  totalPages,
  startIndex,
  endIndex,
  goToPreviousPage,
  goToNextPage,
  handlePageSizeChange,
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <CircularProgress />
        <span className="ml-2 text-gray-500">Loading...</span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <div className="text-center text-gray-500 py-12">
          <p className="text-lg">No data found.</p>
          <p className="text-sm mt-2">
            Try adjusting your filters or refresh the page.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto rounded-lg">
        <Table className="min-w-full">
          <TableHeader>
            <TableRow>
              <TableHead
                onClick={() => requestSort('name')}
                className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
              >
                Name{getSortDirection('name')}
              </TableHead>
              <TableHead
                onClick={() => requestSort('username')}
                className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
              >
                User{getSortDirection('username')}
              </TableHead>
              <TableHead
                onClick={() => requestSort('user id')}
                className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
              >
                User ID{getSortDirection('user id')}
              </TableHead>
              <TableHead
                onClick={() => requestSort('role')}
                className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
              >
                Role{getSortDirection('role')}
              </TableHead>
              <TableHead
                onClick={() => requestSort('gpu type')}
                className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
              >
                GPU Type{getSortDirection('gpu type')}
              </TableHead>
              <TableHead
                onClick={() => requestSort('gpuCount')}
                className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
              >
                GPUs{getSortDirection('gpuCount')}
              </TableHead>
              <TableHead>Nodes</TableHead>
              <TableHead
                onClick={() => requestSort('infra')}
                className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
              >
                Infra{getSortDirection('infra')}
              </TableHead>
              <TableHead
                onClick={() => requestSort('status')}
                className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
              >
                Status{getSortDirection('status')}
              </TableHead>
              <TableHead
                onClick={() => requestSort('workspace')}
                className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
              >
                Workspace{getSortDirection('workspace')}
              </TableHead>
              <TableHead
                onClick={() => requestSort('time')}
                className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
              >
                Launched{getSortDirection('time')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, index) => (
              <TableRow key={row.cluster_hash || index}>
                <TableCell className="truncate" title={row.name}>
                  {row.name}
                </TableCell>
                <TableCell className="truncate" title={row.username}>
                  {row.username}
                </TableCell>
                <TableCell className="truncate" title={row['user id']}>
                  {row['user id']}
                </TableCell>
                <TableCell className="truncate" title={row.role}>
                  {row.role}
                </TableCell>
                <TableCell className="truncate" title={row['gpu type']}>
                  {row['gpu type']}
                </TableCell>
                <TableCell>{row.gpuCount}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.nodes || 1}
                </TableCell>
                <TableCell className="truncate" title={row.infra}>
                  {row.infra}
                </TableCell>
                <TableCell>
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      row.status === 'UP'
                        ? 'bg-green-100 text-green-800'
                        : row.status === 'STOPPED'
                          ? 'bg-gray-100 text-gray-800'
                          : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {row.status}
                  </span>
                </TableCell>
                <TableCell className="truncate" title={row.workspace}>
                  {row.workspace}
                </TableCell>
                <TableCell>
                  {row.time ? <TimestampWithTooltip date={row.time} /> : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination controls */}
      {totalData.length > 0 && (
        <div className="flex justify-end items-center py-2 px-4 text-sm text-gray-700">
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <span className="mr-2">Rows per page:</span>
              <div className="relative inline-block">
                <select
                  value={pageSize}
                  onChange={handlePageSizeChange}
                  className="py-1 pl-2 pr-6 appearance-none outline-none cursor-pointer border-none bg-transparent"
                  style={{ minWidth: '40px' }}
                >
                  <option value={10}>10</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 text-gray-500 absolute right-0 top-1/2 transform -translate-y-1/2 pointer-events-none"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>
            <div>
              {`${startIndex + 1} - ${Math.min(endIndex, totalData.length)} of ${totalData.length}`}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={goToPreviousPage}
                disabled={currentPage === 1}
                className="text-gray-500 h-8 w-8 p-0"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="chevron-left"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={goToNextPage}
                disabled={currentPage === totalPages || totalPages === 0}
                className="text-gray-500 h-8 w-8 p-0"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="chevron-right"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// Filter options for Monthly Report
const MONTHLY_REPORT_PROPERTY_OPTIONS = [
  {
    label: 'User',
    value: 'user_name',
  },
  {
    label: 'Job ID',
    value: 'job_id',
  },
  {
    label: 'Job Type',
    value: 'job_type',
  },
  {
    label: 'GPU Type',
    value: 'requested_gpu_type',
  },
];

// FilterDropdown component (from clusters.jsx)
const FilterDropdown = ({
  propertyList = [],
  valueList,
  setFilters,
  updateURLParams,
  placeholder = 'Filter',
}) => {
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState('');
  const [propertyValue, setPropertValue] = useState('user_name');
  const [valueOptions, setValueOptions] = useState([]);

  // Handle clicks outside the dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        inputRef.current &&
        !inputRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    let updatedValueOptions = [];

    if (valueList && typeof valueList === 'object') {
      switch (propertyValue) {
        case 'user_name':
          updatedValueOptions = valueList.user_name || [];
          break;
        case 'job_id':
          updatedValueOptions = valueList.job_id || [];
          break;
        case 'job_type':
          updatedValueOptions = valueList.job_type || [];
          break;
        case 'requested_gpu_type':
          updatedValueOptions = valueList.requested_gpu_type || [];
          break;
        default:
          break;
      }
    }

    // Filter options based on current input value
    if (value.trim() !== '') {
      updatedValueOptions = updatedValueOptions.filter(
        (item) =>
          item && item.toString().toLowerCase().includes(value.toLowerCase())
      );
    }

    setValueOptions(updatedValueOptions);
  }, [propertyValue, valueList, value]);

  // Helper function to get the capitalized label for a property value
  const getPropertyLabel = (propertyValue) => {
    const propertyItem = propertyList.find(
      (item) => item.value === propertyValue
    );
    return propertyItem ? propertyItem.label : propertyValue;
  };

  const handleValueChange = (e) => {
    setValue(e.target.value);
    if (!isOpen) {
      setIsOpen(true);
    }
  };

  const handleInputFocus = () => {
    setIsOpen(true);
  };

  const handleOptionSelect = (option) => {
    setFilters((prevFilters) => {
      const updatedFilters = [
        ...prevFilters,
        {
          property: getPropertyLabel(propertyValue),
          operator: ':',
          value: option,
        },
      ];

      updateURLParams(updatedFilters);
      return updatedFilters;
    });
    setIsOpen(false);
    setValue('');
    inputRef.current.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && value.trim() !== '') {
      setFilters((prevFilters) => {
        const updatedFilters = [
          ...prevFilters,
          {
            property: getPropertyLabel(propertyValue),
            operator: ':',
            value: value,
          },
        ];

        updateURLParams(updatedFilters);
        return updatedFilters;
      });
      setValue('');
      setIsOpen(false);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current.blur();
    }
  };

  return (
    <div className="flex flex-row border border-gray-300 rounded-md overflow-visible">
      <div className="border-r border-gray-300 flex-shrink-0">
        <Select onValueChange={setPropertValue} value={propertyValue}>
          <SelectTrigger
            aria-label="Filter Property"
            className="focus:ring-0 focus:ring-offset-0 border-none rounded-l-md rounded-r-none w-20 sm:w-24 md:w-32 h-8 text-xs sm:text-sm"
          >
            <SelectValue placeholder="User" />
          </SelectTrigger>
          <SelectContent>
            {propertyList.map((item, index) => (
              <SelectItem key={`property-item-${index}`} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="relative flex-1">
        <input
          type="text"
          ref={inputRef}
          placeholder={placeholder}
          value={value}
          onChange={handleValueChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          className="h-8 w-full sm:w-96 px-3 pr-8 text-sm border-none rounded-l-none rounded-r-md focus:ring-0 focus:outline-none"
          autoComplete="off"
        />
        {value && (
          <button
            onClick={() => {
              setValue('');
              setIsOpen(false);
            }}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            title="Clear filter"
            tabIndex={-1}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
        {isOpen && valueOptions.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto"
            style={{ zIndex: 9999 }}
          >
            {valueOptions.map((option, index) => (
              <div
                key={`${option}-${index}`}
                className={`px-3 py-2 cursor-pointer hover:bg-gray-50 text-sm ${
                  index !== valueOptions.length - 1
                    ? 'border-b border-gray-100'
                    : ''
                }`}
                onClick={() => handleOptionSelect(option)}
              >
                <span className="text-sm text-gray-700">{option}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Filters component (from clusters.jsx)
const Filters = ({ filters = [], setFilters, updateURLParams }) => {
  const onRemove = (index) => {
    setFilters((prevFilters) => {
      const updatedFilters = prevFilters.filter(
        (_, _index) => _index !== index
      );

      updateURLParams(updatedFilters);

      return updatedFilters;
    });
  };

  const clearFilters = () => {
    updateURLParams([]);
    setFilters([]);
  };

  return (
    <>
      <div className="flex items-center gap-4 py-2 px-2">
        <div className="flex flex-wrap items-content gap-2">
          {filters.map((filter, _index) => (
            <FilterItem
              key={`filteritem-${_index}`}
              filter={filter}
              onRemove={() => onRemove(_index)}
            />
          ))}

          {filters.length > 0 && (
            <>
              <button
                onClick={clearFilters}
                className="rounded-full px-4 py-1 text-sm text-gray-700 bg-gray-200 hover:bg-gray-300"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
};

// FilterItem component (from clusters.jsx)
const FilterItem = ({ filter, onRemove }) => {
  return (
    <>
      <div className="flex items-center text-blue-600 bg-blue-100 px-1 py-1 rounded-full text-sm">
        <div className="flex items-center gap-1 px-2">
          <span>{`${filter.property} `}</span>
          <span>{`${filter.operator} `}</span>
          <span>{` ${filter.value}`}</span>
        </div>

        <button
          onClick={() => onRemove()}
          className="p-0.5 ml-1 transform text-gray-400 hover:text-gray-600 bg-blue-500 hover:bg-blue-600 rounded-full flex flex-col items-center"
          title="Clear filter"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            stroke="white"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={5}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </>
  );
};

// Monthly Report View Component
function MonthlyReportView({ monthlyData, isLoading }) {
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortConfig, setSortConfig] = useState({
    key: 'total_cost_usd',
    direction: 'descending',
  });
  const [filters, setFilters] = useState([]);
  const [optionValues, setOptionValues] = useState({
    user_name: [],
    job_id: [],
    job_type: [],
    requested_gpu_type: [],
  });

  // Property map for filter URL parameters
  const propertyMap = useMemo(
    () =>
      new Map([
        ['User', 'user_name'],
        ['Job ID', 'job_id'],
        ['Job Type', 'job_type'],
        ['GPU Type', 'requested_gpu_type'],
      ]),
    []
  );

  // Initialize filters from URL parameters
  useEffect(() => {
    if (router.isReady) {
      const urlFilters = sharedUpdateFiltersByURLParams(router, propertyMap);
      if (urlFilters.length > 0) {
        setFilters(urlFilters);
      }
    }
  }, [router.isReady, router, propertyMap]);

  // Update URL params when filters change
  const updateURLParams = useCallback(
    (newFilters) => {
      if (!router.isReady) return;

      const query = { ...router.query };
      if (newFilters.length === 0) {
        delete query.filters;
      } else {
        query.filters = JSON.stringify(newFilters);
      }

      router.replace(
        {
          pathname: router.pathname,
          query,
        },
        undefined,
        { shallow: true }
      );
    },
    [router]
  );

  // Calculate option values from monthlyData
  useEffect(() => {
    if (monthlyData.length === 0) return;

    const newOptionValues = {
      user_name: [],
      job_id: [],
      job_type: [],
      requested_gpu_type: [],
    };

    const pushWithoutDuplication = (array, value) => {
      if (value && !array.includes(value)) {
        array.push(value);
      }
    };

    monthlyData.forEach((record) => {
      pushWithoutDuplication(newOptionValues.user_name, record.user_name);
      pushWithoutDuplication(newOptionValues.job_id, record.job_id);
      pushWithoutDuplication(newOptionValues.job_type, record.job_type);
      pushWithoutDuplication(
        newOptionValues.requested_gpu_type,
        record.requested_gpu_type
      );
    });

    // Sort option values
    Object.keys(newOptionValues).forEach((key) => {
      newOptionValues[key].sort();
    });

    setOptionValues(newOptionValues);
  }, [monthlyData]);

  // Evaluate condition for filtering
  const evaluateCondition = useCallback((item, filter) => {
    const { property, operator, value } = filter;

    if (!value) return true;

    // Map property label to data field
    const fieldMap = {
      User: 'user_name',
      'Job ID': 'job_id',
      'Job Type': 'job_type',
      'GPU Type': 'requested_gpu_type',
    };

    const field = fieldMap[property] || property.toLowerCase();
    const itemValue = item[field]?.toString().toLowerCase() || '';
    const filterValue = value.toString().toLowerCase();

    switch (operator) {
      case '=':
        return itemValue === filterValue;
      case ':':
        return itemValue.includes(filterValue);
      default:
        return true;
    }
  }, []);

  // Filter data
  const filteredData = useMemo(() => {
    if (filters.length === 0) {
      return monthlyData;
    }

    return monthlyData.filter((item) => {
      let result = null;

      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i];
        const current = evaluateCondition(item, filter);

        if (result === null) {
          result = current;
        } else {
          result = result && current;
        }
      }

      return result;
    });
  }, [monthlyData, filters, evaluateCondition]);

  // Calculate aggregated stats from filtered data
  const filteredAggregatedStats = useMemo(() => {
    if (filteredData.length === 0) {
      return null;
    }
    return aggregateMonthlyReport(filteredData);
  }, [filteredData]);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <CircularProgress />
        <span className="ml-2 text-gray-500">Loading...</span>
      </div>
    );
  }

  if (monthlyData.length === 0) {
    return (
      <Card>
        <div className="text-center text-gray-500 py-12">
          <p className="text-lg">No data available for this month.</p>
        </div>
      </Card>
    );
  }

  // Sort data
  const sortedData = sortData(
    filteredData,
    sortConfig.key,
    sortConfig.direction
  );

  // Calculate pagination
  const totalPages = Math.ceil(sortedData.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedData = sortedData.slice(startIndex, endIndex);

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
    setCurrentPage(1); // Reset to first page when sorting
  };

  const getSortDirection = (key) => {
    if (sortConfig.key === key) {
      return sortConfig.direction === 'ascending' ? ' ↑' : ' ↓';
    }
    return '';
  };

  const goToPreviousPage = () => {
    setCurrentPage((page) => Math.max(page - 1, 1));
  };

  const goToNextPage = () => {
    setCurrentPage((page) => Math.min(page + 1, totalPages));
  };

  const handlePageSizeChange = (e) => {
    const newSize = parseInt(e.target.value, 10);
    setPageSize(newSize);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6 mt-6">
      {/* Filter Section */}
      <div>
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="w-full sm:w-auto">
            <FilterDropdown
              propertyList={MONTHLY_REPORT_PROPERTY_OPTIONS}
              valueList={optionValues}
              setFilters={setFilters}
              updateURLParams={updateURLParams}
              placeholder="Filter report data"
            />
          </div>
        </div>
        <Filters
          filters={filters}
          setFilters={setFilters}
          updateURLParams={updateURLParams}
        />
      </div>

      {/* Aggregated Statistics Cards */}
      {filteredAggregatedStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 !mt-2">
          <Card className="p-4">
            <div className="text-sm text-gray-500">Total Users</div>
            <div className="text-2xl font-bold">
              {filteredAggregatedStats.total_users}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-gray-500">Total Jobs</div>
            <div className="text-2xl font-bold">
              {filteredAggregatedStats.total_jobs}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-gray-500">Total Cost (USD)</div>
            <div className="text-2xl font-bold">
              ${filteredAggregatedStats.total_cost.toFixed(2)}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-gray-500">Total GPU Hours</div>
            <div className="text-2xl font-bold">
              {(filteredAggregatedStats.total_execution_time / 3600).toFixed(1)}
              h
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-gray-500">Avg GPU Utilization</div>
            <div className="text-2xl font-bold">
              {filteredAggregatedStats.avg_gpu_utilization < 0
                ? '-'
                : `${filteredAggregatedStats.avg_gpu_utilization.toFixed(1)}%`}
            </div>
          </Card>
        </div>
      )}

      {/* Detailed Report Table */}
      <Card>
        <div className="overflow-x-auto rounded-lg">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead
                  onClick={() => requestSort('user_name')}
                  className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                >
                  User{getSortDirection('user_name')}
                </TableHead>
                <TableHead
                  onClick={() => requestSort('job_id')}
                  className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                >
                  Job ID{getSortDirection('job_id')}
                </TableHead>
                <TableHead
                  onClick={() => requestSort('job_type')}
                  className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                >
                  Job Type{getSortDirection('job_type')}
                </TableHead>
                <TableHead
                  onClick={() => requestSort('num_nodes')}
                  className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                >
                  Nodes{getSortDirection('num_nodes')}
                </TableHead>
                <TableHead
                  onClick={() => requestSort('requested_gpu_count')}
                  className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                >
                  GPU Count{getSortDirection('requested_gpu_count')}
                </TableHead>
                <TableHead
                  onClick={() => requestSort('requested_gpu_type')}
                  className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                >
                  GPU Type{getSortDirection('requested_gpu_type')}
                </TableHead>
                <TableHead
                  onClick={() => requestSort('total_execution_time_seconds')}
                  className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                >
                  Execution Time
                  {getSortDirection('total_execution_time_seconds')}
                </TableHead>
                <TableHead
                  onClick={() => requestSort('total_cost_usd')}
                  className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                >
                  Cost (USD){getSortDirection('total_cost_usd')}
                </TableHead>
                <TableHead
                  onClick={() => requestSort('avg_gpu_utilization_pct')}
                  className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                >
                  GPU Utilization{getSortDirection('avg_gpu_utilization_pct')}
                </TableHead>
                <TableHead
                  onClick={() => requestSort('job_status')}
                  className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                >
                  Status{getSortDirection('job_status')}
                </TableHead>
                <TableHead className="whitespace-nowrap">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.map((record, index) => (
                <TableRow key={index}>
                  <TableCell>{record.user_name || record.user_id}</TableCell>
                  <TableCell className="truncate" title={record.job_id}>
                    {record.job_id}
                  </TableCell>
                  <TableCell>{record.job_type}</TableCell>
                  <TableCell>{record.num_nodes || 1}</TableCell>
                  <TableCell>{record.requested_gpu_count || 0}</TableCell>
                  <TableCell>{record.requested_gpu_type}</TableCell>
                  <TableCell>
                    {Math.floor(record.total_execution_time_seconds / 3600)}h{' '}
                    {Math.floor(
                      (record.total_execution_time_seconds % 3600) / 60
                    )}
                    m
                  </TableCell>
                  <TableCell>${record.total_cost_usd.toFixed(2)}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'px-2 py-1 rounded text-xs bg-gray-100 text-gray-800',
                        {
                          'bg-green-100 text-green-800':
                            record.avg_gpu_utilization_pct >= 70,
                          'bg-orange-100 text-orange-800':
                            record.avg_gpu_utilization_pct >= 30 &&
                            record.avg_gpu_utilization_pct < 70,
                          'bg-red-100 text-red-800':
                            record.avg_gpu_utilization_pct >= 0 &&
                            record.avg_gpu_utilization_pct < 30,
                        }
                      )}
                    >
                      {record.avg_gpu_utilization_pct < 0
                        ? '-'
                        : `${record.avg_gpu_utilization_pct.toFixed(1)}%`}
                    </span>
                  </TableCell>
                  <TableCell>{record.job_status}</TableCell>
                  <TableCell>
                    {record.cluster_hash ? (
                      <Link
                        href={`/clusters/${record.cluster_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-blue hover:text-sky-blue-bright font-medium inline-flex items-center"
                      >
                        <ExternalLink className="h-5 w-5" />
                      </Link>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination controls */}
        {monthlyData.length > 0 && (
          <div className="flex justify-end items-center py-2 px-4 text-sm text-gray-700">
            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <span className="mr-2">Rows per page:</span>
                <div className="relative inline-block">
                  <select
                    value={pageSize}
                    onChange={handlePageSizeChange}
                    className="py-1 pl-2 pr-6 appearance-none outline-none cursor-pointer border-none bg-transparent"
                    style={{ minWidth: '40px' }}
                  >
                    <option value={10}>10</option>
                    <option value={30}>30</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 text-gray-500 absolute right-0 top-1/2 transform -translate-y-1/2 pointer-events-none"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </div>
              <div>
                {`${startIndex + 1} - ${Math.min(endIndex, sortedData.length)} of ${sortedData.length}`}
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={goToPreviousPage}
                  disabled={currentPage === 1}
                  className="text-gray-500 h-8 w-8 p-0"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="chevron-left"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages || totalPages === 0}
                  className="text-gray-500 h-8 w-8 p-0"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="chevron-right"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// User Pattern Analysis View Component
function UserArchetypesView({ userArchetypes, aggregatedStats, isLoading }) {
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortConfig, setSortConfig] = useState({
    key: 'total_cost',
    direction: 'descending',
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <CircularProgress />
        <span className="ml-2 text-gray-500">Loading...</span>
      </div>
    );
  }

  const userList = Object.values(userArchetypes || {});
  const selectedUser = selectedUserId ? userArchetypes[selectedUserId] : null;

  // Sort data
  const sortedData = sortData(userList, sortConfig.key, sortConfig.direction);

  // Calculate pagination for user list
  const totalPages = Math.ceil(sortedData.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedUserList = sortedData.slice(startIndex, endIndex);

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
    setCurrentPage(1); // Reset to first page when sorting
  };

  const getSortDirection = (key) => {
    if (sortConfig.key === key) {
      return sortConfig.direction === 'ascending' ? ' ↑' : ' ↓';
    }
    return '';
  };

  const goToPreviousPage = () => {
    setCurrentPage((page) => Math.max(page - 1, 1));
  };

  const goToNextPage = () => {
    setCurrentPage((page) => Math.min(page + 1, totalPages));
  };

  const handlePageSizeChange = (e) => {
    const newSize = parseInt(e.target.value, 10);
    setPageSize(newSize);
    setCurrentPage(1);
  };

  // Statistics by Archetype - initialize all archetypes with 0
  const archetypeCounts = {};
  // Initialize all archetypes with 0
  Object.values(USER_ARCHETYPES).forEach((archetype) => {
    archetypeCounts[archetype] = 0;
  });
  // Count actual users
  Object.values(userArchetypes || {}).forEach((user) => {
    const archetype = user.archetype || USER_ARCHETYPES.INTERACTIVE_DEVELOPER;
    archetypeCounts[archetype] = (archetypeCounts[archetype] || 0) + 1;
  });

  // Generate platform improvement suggestions
  const improvements = aggregatedStats
    ? generatePlatformImprovements({
        interactive_ratio: aggregatedStats.interactive_ratio || 0,
        waiting_ratio: 0.1, // Estimated value
        hog_count: Object.values(userArchetypes || {}).filter(
          (u) => u.archetype === USER_ARCHETYPES.HOG_USER
        ).length,
        avg_gpu_utilization: aggregatedStats.avg_gpu_utilization || 0,
      })
    : [];

  return (
    <div className="space-y-6">
      {/* Archetype Distribution */}
      <Card>
        <div className="p-4">
          <h3 className="text-lg font-semibold mb-4">
            User Pattern Distribution
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {Object.entries(archetypeCounts)
              .sort(([, countA], [, countB]) => {
                // Sort: users > 0 first, then by count descending
                if (countA > 0 && countB === 0) return -1;
                if (countA === 0 && countB > 0) return 1;
                return countB - countA; // Descending order for same category
              })
              .map(([archetype, count]) => (
                <NonCapitalizedTooltip
                  key={archetype}
                  content={getArchetypeExplanation(archetype)}
                  placement="bottom"
                >
                  <div
                    className={`text-center p-4 rounded cursor-help transition-colors ${
                      count > 0
                        ? 'bg-gray-50 hover:bg-gray-100'
                        : 'bg-gray-50 hover:bg-gray-100 opacity-60'
                    }`}
                  >
                    <div className="text-2xl font-bold">{count}</div>
                    <div className="text-sm text-gray-600 mt-1">
                      {ARCHETYPE_NAMES[archetype] || archetype}
                    </div>
                  </div>
                </NonCapitalizedTooltip>
              ))}
          </div>
        </div>
      </Card>

      {/* User List */}
      <Card>
        <div className="p-4">
          <h3 className="text-lg font-semibold mb-4">User List</h3>
          <div className="overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead
                    onClick={() => requestSort('user_name')}
                    className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                  >
                    User{getSortDirection('user_name')}
                  </TableHead>
                  <TableHead
                    onClick={() => requestSort('archetype')}
                    className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                  >
                    Pattern{getSortDirection('archetype')}
                  </TableHead>
                  <TableHead
                    onClick={() => requestSort('confidence')}
                    className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                  >
                    Confidence{getSortDirection('confidence')}
                  </TableHead>
                  <TableHead
                    onClick={() => requestSort('total_jobs')}
                    className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                  >
                    Total Jobs{getSortDirection('total_jobs')}
                  </TableHead>
                  <TableHead
                    onClick={() => requestSort('total_cost')}
                    className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                  >
                    Total Cost{getSortDirection('total_cost')}
                  </TableHead>
                  <TableHead
                    onClick={() => requestSort('avg_gpu_utilization')}
                    className="sortable whitespace-nowrap cursor-pointer hover:bg-gray-50"
                  >
                    Avg GPU Utilization{getSortDirection('avg_gpu_utilization')}
                  </TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedUserList.map((user) => (
                  <TableRow key={user.user_name}>
                    <TableCell>{user.user_name}</TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          user.archetype === USER_ARCHETYPES.BATCH_TRAINER
                            ? 'bg-green-100 text-green-800'
                            : user.archetype === USER_ARCHETYPES.HOG_USER
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {ARCHETYPE_NAMES[user.archetype] || user.archetype}
                      </span>
                    </TableCell>
                    <TableCell>{(user.confidence * 100).toFixed(0)}%</TableCell>
                    <TableCell>{user.total_jobs}</TableCell>
                    <TableCell>${user.total_cost.toFixed(2)}</TableCell>
                    <TableCell>
                      {user.avg_gpu_utilization < 0
                        ? '-'
                        : `${user.avg_gpu_utilization.toFixed(1)}%`}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setSelectedUserId(
                            selectedUserId === user.user_id
                              ? null
                              : user.user_id
                          )
                        }
                      >
                        {selectedUserId === user.user_id ? 'Close' : 'Details'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination controls */}
          {userList.length > 0 && (
            <div className="flex justify-end items-center py-2 px-4 text-sm text-gray-700">
              <div className="flex items-center space-x-4">
                <div className="flex items-center">
                  <span className="mr-2">Rows per page:</span>
                  <div className="relative inline-block">
                    <select
                      value={pageSize}
                      onChange={handlePageSizeChange}
                      className="py-1 pl-2 pr-6 appearance-none outline-none cursor-pointer border-none bg-transparent"
                      style={{ minWidth: '40px' }}
                    >
                      <option value={10}>10</option>
                      <option value={30}>30</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                    </select>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4 text-gray-500 absolute right-0 top-1/2 transform -translate-y-1/2 pointer-events-none"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
                <div>
                  {`${startIndex + 1} - ${Math.min(endIndex, sortedData.length)} of ${sortedData.length}`}
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={goToPreviousPage}
                    disabled={currentPage === 1}
                    className="text-gray-500 h-8 w-8 p-0"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="chevron-left"
                    >
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={goToNextPage}
                    disabled={currentPage === totalPages || totalPages === 0}
                    className="text-gray-500 h-8 w-8 p-0"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="chevron-right"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Selected User Details */}
      {selectedUser && (
        <Card>
          <div className="p-4">
            <h3 className="text-lg font-semibold mb-4">
              {selectedUser.user_name || selectedUser.user_id} - Details
            </h3>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Pattern Description</h4>
                <p className="text-sm text-gray-600">
                  {ARCHETYPE_DESCRIPTIONS[selectedUser.archetype]}
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-gray-500">Total Jobs</div>
                  <div className="text-lg font-bold">
                    {selectedUser.total_jobs}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Total Cost</div>
                  <div className="text-lg font-bold">
                    ${selectedUser.total_cost.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">
                    Avg GPU Utilization
                  </div>
                  <div className="text-lg font-bold">
                    {selectedUser.avg_gpu_utilization < 0
                      ? '-'
                      : `${selectedUser.avg_gpu_utilization.toFixed(1)}%`}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Spot Ratio</div>
                  <div className="text-lg font-bold">
                    {(selectedUser.spot_ratio * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
              <div>
                <h4 className="font-medium mb-2">Custom Guidelines</h4>
                <div className="space-y-2">
                  {generateUserGuidelines(selectedUser).map(
                    (guideline, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded ${
                          guideline.type === 'error'
                            ? 'bg-red-50 border border-red-200'
                            : guideline.type === 'warning'
                              ? 'bg-yellow-50 border border-yellow-200'
                              : guideline.type === 'success'
                                ? 'bg-green-50 border border-green-200'
                                : 'bg-blue-50 border border-blue-200'
                        }`}
                      >
                        <div className="font-medium text-sm">
                          {guideline.title}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {guideline.message}
                        </div>
                        {guideline.action && (
                          <div className="mt-2">
                            <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                              {guideline.action}
                            </code>
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Platform Improvement Suggestions */}
      {improvements.length > 0 && (
        <Card>
          <div className="p-4">
            <h3 className="text-lg font-semibold mb-4">
              Platform Improvement Suggestions
            </h3>
            <div className="space-y-3">
              {improvements.map((improvement, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded border-l-4 ${
                    improvement.priority === 'high'
                      ? 'border-red-500 bg-red-50'
                      : 'border-yellow-500 bg-yellow-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            improvement.priority === 'high'
                              ? 'bg-red-200 text-red-800'
                              : 'bg-yellow-200 text-yellow-800'
                          }`}
                        >
                          {improvement.priority === 'high' ? 'High' : 'Medium'}
                        </span>
                        <span className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-700">
                          {improvement.category}
                        </span>
                      </div>
                      <h4 className="font-medium mb-1">{improvement.title}</h4>
                      <p className="text-sm text-gray-600">
                        {improvement.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// PropTypes
SuccessDisplay.propTypes = {
  message: PropTypes.string,
  onDismiss: PropTypes.func,
};

ReportCard.propTypes = {
  data: PropTypes.array.isRequired,
  isLoading: PropTypes.bool.isRequired,
  requestSort: PropTypes.func.isRequired,
  getSortDirection: PropTypes.func.isRequired,
  totalData: PropTypes.array.isRequired,
  currentPage: PropTypes.number.isRequired,
  pageSize: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  startIndex: PropTypes.number.isRequired,
  endIndex: PropTypes.number.isRequired,
  goToPreviousPage: PropTypes.func.isRequired,
  goToNextPage: PropTypes.func.isRequired,
  handlePageSizeChange: PropTypes.func.isRequired,
};

MonthlyReportView.propTypes = {
  monthlyData: PropTypes.array.isRequired,
  isLoading: PropTypes.bool.isRequired,
};

UserArchetypesView.propTypes = {
  userArchetypes: PropTypes.object.isRequired,
  aggregatedStats: PropTypes.object,
  isLoading: PropTypes.bool.isRequired,
};
