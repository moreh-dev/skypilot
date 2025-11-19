/**
 * Monthly GPU Usage Report Data Processing Utility
 * Generate report data based on integrated data schema specified in the document
 */

import { extractGPUInfo, extractNodeCount } from '@/utils/gpuUtils';
import { getGrafanaUrl } from '@/utils/grafana';

/**
 * @typedef {import('@/types/cluster').Cluster} Cluster
 */

/**
 * Prometheus query result cache
 * Key format: `${clusterId}_${startTime}_${endTime}`
 * Value: { result: number, timestamp: number }
 */
const prometheusCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour cache TTL

/**
 * Generate cache key for Prometheus query
 */
function getCacheKey(cluster, startTime, endTime) {
  const clusterId =
    cluster.cluster_name_on_cloud ||
    `${cluster.cluster}-${cluster.user_hash}` ||
    cluster.cluster ||
    'unknown';
  return `${clusterId}_${startTime}_${endTime}`;
}

/**
 * Get cached Prometheus result if available and not expired
 */
function getCachedResult(cacheKey) {
  const cached = prometheusCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }
  return null;
}

/**
 * Store Prometheus result in cache
 */
function setCachedResult(cacheKey, result) {
  prometheusCache.set(cacheKey, {
    result,
    timestamp: Date.now(),
  });
}

/**
 * Clear expired cache entries (optional cleanup)
 */
function clearExpiredCache() {
  const now = Date.now();
  for (const [key, value] of prometheusCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL) {
      prometheusCache.delete(key);
    }
  }
}

/**
 * Clear all cache (useful for manual refresh)
 */
export function clearPrometheusCache() {
  prometheusCache.clear();
}

/**
 * Convert cluster and job data to monthly report schema
 * @param {Cluster[]} clusters - Cluster data array
 * @param {string} reportMonth - Report target month (YYYY-MM format)
 * @param {Object[]} [jobs=[]] - Managed jobs data array for matching
 * @param {Object} [options] - Optional configuration
 * @param {boolean} [options.useCache=true] - Whether to use cache (default: true)
 * @param {boolean} [options.skipPrometheus=false] - Skip Prometheus queries entirely (default: false)
 * @returns {Promise<Array>} Monthly report data array
 */
export async function generateMonthlyReportData(
  clusters,
  reportMonth,
  jobs = [],
  options = {}
) {
  const { useCache = true, skipPrometheus = false } = options || {};

  // Clean up expired cache entries periodically
  if (useCache && prometheusCache.size > 100) {
    clearExpiredCache();
  }
  const reportData = [];
  const targetMonth = reportMonth || getCurrentMonth();

  // Convert cluster data to report schema
  const clusterPromises = clusters.map(async (cluster) => {
    // Check if cluster's execution period overlaps with the target month
    if (!isInMonth(cluster, targetMonth)) {
      return null;
    }

    // Find matching job for this cluster
    const matchedJob = findMatchingJob(cluster, jobs);

    // Determine Job Type (Interactive vs Managed Batch) based on matched job
    const jobType = matchedJob ? 'Managed Batch' : 'Interactive';
    const isSpot = cluster.resources_str?.includes('Spot') || false;

    // Calculate execution time for this specific month (only the portion in target month)
    const executionTime = calculateExecutionTimeForMonth(cluster, targetMonth);
    const queueTime = calculateQueueTime(cluster);

    // Extract GPU information
    const gpuInfo = extractGPUInfo(
      cluster.gpus,
      cluster.resources_str_full ?? cluster.resources_str
    );

    // Extract node count
    const nodeCount = extractNodeCount(
      cluster.resources_str_full ?? cluster.resources_str,
      cluster.num_nodes
    );

    // Calculate time range for GPU utilization query (only for the target month portion)
    let startTime, endTime;
    const period = getClusterExecutionPeriod(cluster);
    if (period) {
      // Parse target month to get start and end of that month
      const [year, monthNum] = targetMonth.split('-').map(Number);
      const monthStart = new Date(year, monthNum - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(year, monthNum, 0, 23, 59, 59, 999);
      const monthStartUnix = monthStart.getTime() / 1000;
      const monthEndUnix = monthEnd.getTime() / 1000;

      // Use the intersection of cluster execution period and target month
      startTime = Math.max(period.startTime, monthStartUnix);
      endTime = Math.min(period.endTime, monthEndUnix);
    } else {
      // Fallback: Use report month boundaries if we can't determine cluster period
      const monthStart = new Date(targetMonth + '-01T00:00:00Z');
      const monthEnd = new Date(
        monthStart.getFullYear(),
        monthStart.getMonth() + 1,
        0,
        23,
        59,
        59
      );
      startTime = monthStart.getTime() / 1000;
      endTime = monthEnd.getTime() / 1000;
    }

    // Get actual GPU utilization from Prometheus (with caching)
    let actualGPUUtilization = -1;
    if (gpuInfo.count > 0 && !skipPrometheus) {
      const cacheKey = getCacheKey(cluster, startTime, endTime);

      // Check cache first
      if (useCache) {
        const cached = getCachedResult(cacheKey);
        if (cached !== null) {
          actualGPUUtilization = cached;
        } else {
          // Fetch from Prometheus and cache the result
          actualGPUUtilization = await getActualGPUUtilization(
            cluster,
            startTime,
            endTime,
            gpuInfo.type
          );
          // Cache the result (even if it's -1, to avoid repeated failed queries)
          if (useCache && actualGPUUtilization !== null) {
            setCachedResult(cacheKey, actualGPUUtilization);
          }
        }
      } else {
        // No cache, fetch directly
        actualGPUUtilization = await getActualGPUUtilization(
          cluster,
          startTime,
          endTime,
          gpuInfo.type
        );
      }
    }

    // Get actual GPU memory usage from Prometheus (with caching)
    const memoryCacheKey = `memory_${getCacheKey(cluster, startTime, endTime)}`;
    let actualGPUMemory = null;
    if (gpuInfo.count > 0 && !skipPrometheus) {
      if (useCache) {
        const cachedMemory = getCachedResult(memoryCacheKey);
        if (cachedMemory !== null) {
          actualGPUMemory = cachedMemory;
        } else {
          actualGPUMemory = await fetchGPUMemoryFromPrometheus(
            cluster,
            startTime,
            endTime,
            gpuInfo.type
          );
          if (useCache && actualGPUMemory !== null) {
            setCachedResult(memoryCacheKey, actualGPUMemory);
          }
        }
      } else {
        actualGPUMemory = await fetchGPUMemoryFromPrometheus(
          cluster,
          startTime,
          endTime,
          gpuInfo.type
        );
      }
    }

    // Get actual GPU power consumption from Prometheus (with caching)
    const powerCacheKey = `power_${getCacheKey(cluster, startTime, endTime)}`;
    let actualGPUPower = null;
    if (gpuInfo.count > 0 && !skipPrometheus) {
      if (useCache) {
        const cachedPower = getCachedResult(powerCacheKey);
        if (cachedPower !== null) {
          actualGPUPower = cachedPower;
        } else {
          actualGPUPower = await fetchGPUPowerFromPrometheus(
            cluster,
            startTime,
            endTime,
            gpuInfo.type
          );
          if (useCache && actualGPUPower !== null) {
            setCachedResult(powerCacheKey, actualGPUPower);
          }
        }
      } else {
        actualGPUPower = await fetchGPUPowerFromPrometheus(
          cluster,
          startTime,
          endTime,
          gpuInfo.type
        );
      }
    }

    // Calculate idle time based on GPU utilization (for this month's portion)
    const idleTime = calculateIdleTime(executionTime, actualGPUUtilization);

    // Cost information (use if already calculated, otherwise calculate based on resources)
    // For month-specific cost, we need to calculate proportionally
    const totalCost = calculateCostForMonth(
      cluster,
      executionTime,
      gpuInfo,
      nodeCount
    );

    const reportRecord = {
      report_month: targetMonth,
      user_id: cluster.user_hash || cluster.user || 'unknown',
      user_name: cluster.user || 'unknown',
      project_id: cluster.workspace || 'default',
      job_id: cluster.cluster,
      job_type: jobType,
      cluster_name: cluster.cluster || '-',
      cluster_hash: cluster.cluster_hash || null,
      requested_gpu_type: gpuInfo.type || '-',
      actual_gpu_type: gpuInfo.type || '-',
      requested_gpu_count: gpuInfo.count || 0,
      actual_gpu_count: gpuInfo.count || 0,
      requested_instance_type: isSpot ? 'Spot' : 'On-Demand',
      total_cost_usd: totalCost,
      total_queue_time_seconds: queueTime,
      total_execution_time_seconds: executionTime,
      total_idle_time_seconds: idleTime,
      avg_gpu_utilization_pct: actualGPUUtilization,
      p95_gpu_memory_used_gb: actualGPUMemory ?? 0, // Fetched from DCGM/Prometheus
      avg_gpu_power_watts: actualGPUPower ?? 0, // Fetched from DCGM/Prometheus
      preemption_count: cluster.recoveries || 0,
      job_status: matchedJob
        ? mapManagedJobStatusToReportStatus(matchedJob.status)
        : mapClusterStatusToJobStatus(cluster.status),
      launched_at: cluster.time ? cluster.time.getTime() / 1000 : null,
      duration: cluster.duration || executionTime,
      num_nodes: nodeCount,
    };

    return reportRecord;
  });

  // Wait for all cluster processing to complete
  const clusterResults = await Promise.all(clusterPromises);

  // Filter out null results and add to reportData
  clusterResults.forEach((result) => {
    if (result) {
      reportData.push(result);
    }
  });

  return reportData;
}

/**
 * Return current month in YYYY-MM format
 */
function getCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get the start and end time of a cluster's execution period
 * @param {Cluster} cluster - Cluster data object
 * @returns {Object|null} Object with startTime and endTime in Unix timestamp (seconds), or null if unavailable
 */
function getClusterExecutionPeriod(cluster) {
  if (!cluster.time) return null;

  const startTime =
    cluster.time instanceof Date
      ? cluster.time.getTime() / 1000
      : new Date(cluster.time).getTime() / 1000;

  let endTime = null;

  // If cluster has end_time field, use it
  if (cluster.end_time) {
    endTime =
      cluster.end_time instanceof Date
        ? cluster.end_time.getTime() / 1000
        : new Date(cluster.end_time).getTime() / 1000;
  } else if (cluster.duration !== undefined && cluster.duration !== null) {
    // Use duration if available
    endTime = startTime + Math.floor(cluster.duration);
  } else if (cluster.status === 'RUNNING') {
    // If cluster is still running, use current time
    endTime = Date.now() / 1000;
  } else {
    // If we can't determine end time, assume it's still running
    endTime = Date.now() / 1000;
  }

  return { startTime, endTime };
}

/**
 * Check if cluster's execution period overlaps with a specific month
 * @param {Cluster} cluster - Cluster data object
 * @param {string} month - Target month in YYYY-MM format
 * @returns {boolean} True if cluster execution period overlaps with the target month
 */
function isInMonth(cluster, month) {
  const period = getClusterExecutionPeriod(cluster);
  if (!period) return false;

  // Parse target month to get start and end of that month
  const [year, monthNum] = month.split('-').map(Number);
  const monthStart = new Date(year, monthNum - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, monthNum, 0, 23, 59, 59, 999);
  const monthStartUnix = monthStart.getTime() / 1000;
  const monthEndUnix = monthEnd.getTime() / 1000;

  // Check if cluster execution period overlaps with the month
  // Overlap occurs if: cluster starts before month ends AND cluster ends after month starts
  return period.startTime <= monthEndUnix && period.endTime >= monthStartUnix;
}

/**
 * Map managed job status to report status format
 * @param {string} managedJobStatus - Managed job status from jobs data
 * @returns {string} Report status ('Running', 'Pending', 'Succeeded', 'Failed', 'Cancelled', etc.)
 */
function mapManagedJobStatusToReportStatus(managedJobStatus) {
  if (!managedJobStatus) {
    return 'Unknown';
  }

  const statusMap = {
    PENDING: 'Pending',
    SUBMITTED: 'Pending',
    STARTING: 'Pending',
    RUNNING: 'Running',
    RECOVERING: 'Running',
    CANCELLING: 'Cancelling',
    SUCCEEDED: 'Succeeded',
    CANCELLED: 'Cancelled',
    FAILED: 'Failed',
    FAILED_SETUP: 'Failed',
    FAILED_PRECHECKS: 'Failed',
    FAILED_NO_RESOURCE: 'Failed',
    FAILED_CONTROLLER: 'Failed',
  };

  return statusMap[managedJobStatus] || managedJobStatus;
}

/**
 * Find a matching managed job for a cluster
 * @param {Cluster} cluster - Cluster data object
 * @param {Object[]} jobs - Managed jobs data array
 * @returns {Object|null} Matching job object or null
 */
function findMatchingJob(cluster, jobs) {
  if (!cluster || !jobs || jobs.length === 0) {
    return null;
  }

  // Try multiple matching strategies
  for (const job of jobs) {
    // Strategy 1: Match by cluster name (most reliable)
    if (
      job.current_cluster_name &&
      (cluster.cluster === job.current_cluster_name ||
        cluster.cluster_name_on_cloud === job.current_cluster_name ||
        cluster.cluster_hash === job.current_cluster_name)
    ) {
      return job;
    }

    // Strategy 2: Match by job ID and name
    if (job.id && job.name && cluster.cluster === `${job.name}-${job.id}`) {
      return job;
    }
  }

  return null;
}

/**
 * Calculate execution time (in seconds) for a specific month
 * Only returns the portion of execution time that belongs to the target month
 * @param {Cluster} cluster - Cluster data object
 * @param {string} targetMonth - Target month in YYYY-MM format
 * @returns {number} Execution time in seconds for the target month
 */
function calculateExecutionTimeForMonth(cluster, targetMonth) {
  const period = getClusterExecutionPeriod(cluster);
  if (!period) return 0;

  // Parse target month to get start and end of that month
  const [year, monthNum] = targetMonth.split('-').map(Number);
  const monthStart = new Date(year, monthNum - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, monthNum, 0, 23, 59, 59, 999);
  const monthStartUnix = monthStart.getTime() / 1000;
  const monthEndUnix = monthEnd.getTime() / 1000;

  // Calculate the intersection of cluster execution period and target month
  const executionStart = Math.max(period.startTime, monthStartUnix);
  const executionEnd = Math.min(period.endTime, monthEndUnix);

  // Return the duration of the intersection
  return Math.max(0, Math.floor(executionEnd - executionStart));
}

/**
 * Calculate queue wait time
 * @param {Cluster} cluster - Cluster data object
 * @returns {number} Queue wait time in seconds
 */
function calculateQueueTime(cluster) {
  // If cluster has submission time and start time, calculate the difference
  if (cluster.submitted_at && cluster.time) {
    const submittedTime =
      cluster.submitted_at instanceof Date
        ? cluster.submitted_at.getTime() / 1000
        : new Date(cluster.submitted_at).getTime() / 1000;
    const startTime =
      cluster.time instanceof Date
        ? cluster.time.getTime() / 1000
        : new Date(cluster.time).getTime() / 1000;

    const queueTime = Math.max(0, startTime - submittedTime);
    return Math.floor(queueTime);
  }

  // If cluster has queue_time field, use it
  if (cluster.queue_time !== undefined && cluster.queue_time !== null) {
    return Math.floor(cluster.queue_time);
  }

  // No queue time data available
  return 0;
}

/**
 * Calculate idle time based on GPU utilization
 * @param {number} executionTime - Total execution time in seconds
 * @param {number} avgGPUUtilization - Average GPU utilization percentage (0-100)
 * @returns {number} Estimated idle time in seconds
 */
function calculateIdleTime(executionTime, avgGPUUtilization) {
  if (!executionTime || executionTime <= 0) {
    return 0;
  }

  // If GPU utilization is available, calculate idle time based on it
  if (avgGPUUtilization !== null && avgGPUUtilization >= 0) {
    // Idle time = execution time * (1 - utilization/100)
    // If utilization is 80%, then 20% of time is idle
    const utilizationRatio = Math.max(0, Math.min(1, avgGPUUtilization / 100));
    return Math.floor(executionTime * (1 - utilizationRatio));
  }

  // Fallback: if no utilization data, return 0 (unknown)
  return 0;
}

/**
 * Determine if GPU type is AMD based on GPU type string
 * @param {string} gpuType - GPU type string (e.g., 'MI250', 'A100', 'H100')
 * @returns {boolean} True if AMD GPU, false if NVIDIA or unknown
 */
function isAMDGPU(gpuType) {
  if (!gpuType) return false;
  const upperType = gpuType.toUpperCase();
  // AMD GPU types typically start with 'MI' (e.g., MI250, MI210)
  return upperType.startsWith('MI');
}

/**
 * Fetch actual GPU memory usage from Prometheus (P95)
 * Falls back to null if unavailable
 * @param {Cluster} cluster - Cluster data object
 * @param {number} startTime - Start time in Unix timestamp
 * @param {number} endTime - End time in Unix timestamp
 * @param {string} gpuType - GPU type string (e.g., 'MI250', 'A100', 'H100')
 * @returns {Promise<number|null>} P95 GPU memory usage in GB
 */
async function fetchGPUMemoryFromPrometheus(
  cluster,
  startTime,
  endTime,
  gpuType
) {
  const clusterName = (
    cluster.cluster_name_on_cloud ||
    `${cluster.cluster}-${cluster.user_hash}` ||
    ''
  )
    .replace(/[._]/g, '-')
    .toLowerCase();

  let promql;
  let result;

  // Choose PromQL query based on GPU type
  if (isAMDGPU(gpuType)) {
    // AMD GPU metrics
    promql = `amd_gpu_memory_used_bytes{pod=~"^${clusterName}.*"}`;
  } else {
    // NVIDIA GPU metrics (DCGM): DCGM_FI_DEV_FB_USED (frame buffer used in bytes)
    promql = `DCGM_FI_DEV_FB_USED{pod=~"^${clusterName}.*"}`;
  }

  result = await fetchMetricFromPrometheus(
    cluster,
    promql,
    startTime,
    endTime,
    'p95'
  );

  // Convert bytes to GB if we got a result
  if (result !== null && result > 0) {
    return result / (1024 * 1024 * 1024); // Convert bytes to GB
  }

  return null;
}

/**
 * Fetch actual GPU power consumption from Prometheus
 * Falls back to null if unavailable
 * @param {Cluster} cluster - Cluster data object
 * @param {number} startTime - Start time in Unix timestamp
 * @param {number} endTime - End time in Unix timestamp
 * @param {string} gpuType - GPU type string (e.g., 'MI250', 'A100', 'H100')
 * @returns {Promise<number|null>} Average GPU power consumption in watts
 */
async function fetchGPUPowerFromPrometheus(
  cluster,
  startTime,
  endTime,
  gpuType
) {
  const clusterName = (
    cluster.cluster_name_on_cloud ||
    `${cluster.cluster}-${cluster.user_hash}` ||
    ''
  )
    .replace(/[._]/g, '-')
    .toLowerCase();

  let promql;

  // Choose PromQL query based on GPU type
  if (isAMDGPU(gpuType)) {
    // AMD GPU metrics
    promql = `amd_gpu_average_package_power{pod=~"^${clusterName}.*"}`;
  } else {
    // NVIDIA GPU metrics (DCGM): DCGM_FI_DEV_POWER_USAGE (in watts)
    promql = `DCGM_FI_DEV_POWER_USAGE{pod=~"^${clusterName}.*"}`;
  }

  const result = await fetchMetricFromPrometheus(
    cluster,
    promql,
    startTime,
    endTime,
    'avg'
  );

  return result;
}

/**
 * GPU type to hourly cost mapping (USD per hour per GPU)
 * These are approximate market rates and should be updated based on actual pricing
 */
const GPU_HOURLY_COST = {
  H100: 4.0, // ~$4/hour per GPU
  A100: 2.5, // ~$2.5/hour per GPU
  A10: 1.0, // ~$1/hour per GPU
  A10G: 1.2, // ~$1.2/hour per GPU
  V100: 0.8, // ~$0.8/hour per GPU
  T4: 0.4, // ~$0.4/hour per GPU
  MI250: 1.5, // ~$1.5/hour per GPU (AMD)
  MI210: 0.8, // ~$0.8/hour per GPU (AMD)
  default: 0.0, // Default fallback
};

/**
 * Calculate cost for a specific month based on GPU type, count, execution time, and node count
 * This calculates the cost proportionally for the month-specific execution time
 * @param {Cluster} cluster - Cluster data object
 * @param {number} executionTime - Execution time in seconds for the target month
 * @param {Object} gpuInfo - GPU information object with type and count (count is per node)
 * @param {number} nodeCount - Number of nodes in the cluster
 * @returns {number} Total cost in USD for the target month
 */
function calculateCostForMonth(cluster, executionTime, gpuInfo, nodeCount = 1) {
  // If total_cost is already available, we need to calculate proportionally
  if (cluster.total_cost > 0) {
    const period = getClusterExecutionPeriod(cluster);
    if (period) {
      const totalExecutionTime = period.endTime - period.startTime;
      if (totalExecutionTime > 0) {
        // Calculate proportional cost: (month execution time / total execution time) * total cost
        const proportionalCost =
          (executionTime / totalExecutionTime) * cluster.total_cost;
        return Math.round(proportionalCost * 100) / 100;
      }
    }
    // If we can't determine proportion, fall through to calculate based on execution time
  }

  // If no execution time or GPU info, return 0
  if (
    !executionTime ||
    executionTime <= 0 ||
    !gpuInfo ||
    !gpuInfo.count ||
    gpuInfo.count <= 0
  ) {
    return 0;
  }

  // Determine hourly cost per GPU
  const gpuType = gpuInfo.type || '';
  let hourlyCostPerGPU = GPU_HOURLY_COST.default;

  // Match GPU type (case-insensitive)
  for (const [key, value] of Object.entries(GPU_HOURLY_COST)) {
    if (
      key !== 'default' &&
      gpuType.toUpperCase().includes(key.toUpperCase())
    ) {
      hourlyCostPerGPU = value;
      break;
    }
  }

  // Apply spot discount if applicable
  const isSpot = cluster.resources_str?.includes('Spot') || false;
  const spotDiscount = isSpot ? 0.7 : 1.0; // 70% of on-demand price for spot

  // Calculate total GPU count: gpuInfo.count is per node, so multiply by nodeCount
  const totalGPUCount = gpuInfo.count * nodeCount;

  // Calculate total cost for this month's portion
  const hours = executionTime / 3600;
  const totalCost = hourlyCostPerGPU * totalGPUCount * hours * spotDiscount;

  return Math.round(totalCost * 100) / 100; // Round to 2 decimal places
}

/**
 * Map cluster status to job status
 */
function mapClusterStatusToJobStatus(clusterStatus) {
  const statusMap = {
    RUNNING: 'Running',
    STOPPED: 'Stopped',
    TERMINATED: 'Succeeded',
    LAUNCHING: 'Pending',
  };
  return statusMap[clusterStatus] || 'Unknown';
}

/**
 * Aggregate monthly report data
 * @param {Array} reportData - Monthly report data array
 * @returns {Object} Aggregated statistics information
 */
export function aggregateMonthlyReport(reportData) {
  const totalUsersSet = new Set();
  const aggregated = {
    total_users: 0,
    total_jobs: reportData.length,
    total_cost: 0,
    total_execution_time: 0,
    total_idle_time: 0,
    total_queue_time: 0,
    interactive_jobs: 0,
    batch_jobs: 0,
    spot_jobs: 0,
    on_demand_jobs: 0,
    gpu_utilization_sum: 0,
    preemption_count: 0,
    succeeded_jobs: 0,
    failed_jobs: 0,
  };

  reportData.forEach((record) => {
    totalUsersSet.add(record.user_id);
    aggregated.total_cost += record.total_cost_usd || 0;
    aggregated.total_execution_time += record.total_execution_time_seconds || 0;
    aggregated.total_idle_time += record.total_idle_time_seconds || 0;
    aggregated.total_queue_time += record.total_queue_time_seconds || 0;
    aggregated.gpu_utilization_sum += Math.max(
      0,
      record.avg_gpu_utilization_pct || 0
    );
    aggregated.preemption_count += record.preemption_count || 0;

    if (record.job_type === 'Interactive') {
      aggregated.interactive_jobs += 1;
    } else if (record.job_type === 'Managed Batch') {
      aggregated.batch_jobs += 1;
    }

    if (record.requested_instance_type === 'Spot') {
      aggregated.spot_jobs += 1;
    } else {
      aggregated.on_demand_jobs += 1;
    }

    if (record.job_status === 'Succeeded') {
      aggregated.succeeded_jobs += 1;
    } else if (record.job_status === 'Failed') {
      aggregated.failed_jobs += 1;
    }
  });

  aggregated.total_users = totalUsersSet.size;
  aggregated.avg_gpu_utilization =
    aggregated.total_jobs > 0
      ? aggregated.gpu_utilization_sum / aggregated.total_jobs
      : 0;
  aggregated.interactive_ratio =
    aggregated.total_jobs > 0
      ? aggregated.interactive_jobs / aggregated.total_jobs
      : 0;
  aggregated.batch_ratio =
    aggregated.total_jobs > 0
      ? aggregated.batch_jobs / aggregated.total_jobs
      : 0;
  aggregated.spot_ratio =
    aggregated.total_jobs > 0
      ? aggregated.spot_jobs / aggregated.total_jobs
      : 0;
  aggregated.success_rate =
    aggregated.total_jobs > 0
      ? aggregated.succeeded_jobs / aggregated.total_jobs
      : 0;

  return aggregated;
}

/**
 * Generic function to fetch metrics from Prometheus
 * @param {Cluster} cluster - Cluster data object
 * @param {string} promql - PromQL query string
 * @param {number} startTime - Start time in Unix timestamp
 * @param {number} endTime - End time in Unix timestamp
 * @param {string} aggregation - Aggregation method: 'avg', 'p95', 'max', 'min' (default: 'avg')
 * @returns {Promise<number|null>} Aggregated metric value or null if failed
 */
async function fetchMetricFromPrometheus(
  cluster,
  promql,
  startTime,
  endTime,
  aggregation = 'avg'
) {
  try {
    const grafanaUrl = getGrafanaUrl();

    // Apply aggregation based on parameter
    let finalPromql = promql;
    if (aggregation === 'p95') {
      finalPromql = `quantile(0.95, ${promql})`;
    } else if (aggregation === 'max') {
      finalPromql = `max(${promql})`;
    } else if (aggregation === 'min') {
      finalPromql = `min(${promql})`;
    } else {
      finalPromql = `avg(${promql})`;
    }

    const queryUrl = `/api/datasources/proxy/uid/prometheus/api/v1/query_range`;
    const params = new URLSearchParams({
      query: finalPromql,
      start: startTime.toString(),
      end: endTime.toString(),
      step: '300', // 5-minute intervals
    });

    const response = await fetch(`${grafanaUrl}${queryUrl}?${params}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();

      if (
        data.status === 'success' &&
        data.data &&
        data.data.result &&
        data.data.result.length > 0
      ) {
        // Calculate aggregated value
        let totalValue = 0;
        let totalPoints = 0;

        data.data.result.forEach((series) => {
          const values = series.values.map((value) => parseFloat(value[1]));
          if (values && values.length > 0) {
            if (aggregation === 'p95') {
              // For p95, we already have quantile in query, just average the results
              totalValue += values.reduce((a, b) => a + b, 0);
            } else {
              totalValue += values.reduce((a, b) => a + b, 0);
            }
            totalPoints += values.length;
          }
        });

        if (totalPoints > 0) {
          return totalValue / totalPoints;
        }
      }
    }
  } catch (error) {
    console.error(`Error fetching metric from Prometheus (${promql}):`, error);
  }

  return null;
}

/**
 * Fetch GPU utilization from Prometheus for a specific cluster and time range
 * @param {Cluster} cluster - Cluster data object
 * @param {number} startTime - Start time in Unix timestamp
 * @param {number} endTime - End time in Unix timestamp
 * @param {string} gpuType - GPU type string (e.g., 'MI250', 'A100', 'H100')
 * @returns {Promise<number>} Average GPU utilization percentage
 */
async function fetchGPUUtilizationFromPrometheus(
  cluster,
  startTime,
  endTime,
  gpuType
) {
  try {
    // Build PromQL query based on cluster info
    // Use cluster name to match the pattern from the provided query
    const clusterName = (
      cluster.cluster_name_on_cloud ||
      `${cluster.cluster ?? ''}-${cluster.user_hash ?? ''}` ||
      ''
    )
      .replace(/[._]/g, '-')
      .toLowerCase();

    let promql;

    // Choose PromQL query based on GPU type
    if (isAMDGPU(gpuType)) {
      // AMD GPU metrics
      promql = `amd_gpu_gfx_activity{pod=~"^${clusterName}.*"}`;
    } else {
      // NVIDIA GPU metrics (DCGM): DCGM_FI_DEV_GPU_UTIL
      promql = `DCGM_FI_DEV_GPU_UTIL{pod=~"^${clusterName}.*"}`;
    }

    const result = await fetchMetricFromPrometheus(
      cluster,
      promql,
      startTime,
      endTime,
      'avg'
    );

    return result;
  } catch (error) {
    console.error('Error fetching GPU utilization from Prometheus:', error);
  }

  return null; // Return null if Prometheus query fails
}

/**
 * Get actual GPU utilization with Prometheus fallback
 * This function can be used when async calls are possible
 * Note: Caching is handled at the generateMonthlyReportData level
 * @param {Cluster} cluster - Cluster data object
 * @param {number} startTime - Start time in Unix timestamp
 * @param {number} endTime - End time in Unix timestamp
 * @param {string} gpuType - GPU type string (e.g., 'MI250', 'A100', 'H100')
 * @returns {Promise<number>} GPU utilization percentage or -1 if unavailable
 */
export async function getActualGPUUtilization(
  cluster,
  startTime,
  endTime,
  gpuType
) {
  // Try to fetch from Prometheus first
  const prometheusUtilization = await fetchGPUUtilizationFromPrometheus(
    cluster,
    startTime,
    endTime,
    gpuType
  );

  if (prometheusUtilization !== null && !isNaN(prometheusUtilization)) {
    return prometheusUtilization;
  }

  // Fall back to negative value
  return -1;
}
