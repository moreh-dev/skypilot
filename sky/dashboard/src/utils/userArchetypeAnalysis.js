/**
 * User Pattern Analysis Utility
 * Logic to classify 5 user Archetypes as specified in the document
 */

import React from 'react';

/**
 * User Archetype Type Definitions
 */
export const USER_ARCHETYPES = {
  INTERACTIVE_DEVELOPER: 'interactive_developer',
  BATCH_TRAINER: 'batch_trainer',
  COST_OPTIMIZER: 'cost_optimizer',
  HOG_USER: 'hog_user',
  WAITING_USER: 'waiting_user',
};

/**
 * Archetype Name Mapping
 */
export const ARCHETYPE_NAMES = {
  [USER_ARCHETYPES.INTERACTIVE_DEVELOPER]: 'Interactive Developer',
  [USER_ARCHETYPES.BATCH_TRAINER]: 'Batch Trainer',
  [USER_ARCHETYPES.COST_OPTIMIZER]: 'Cost Optimizer',
  [USER_ARCHETYPES.HOG_USER]: 'Resource Hog',
  [USER_ARCHETYPES.WAITING_USER]: 'Waiting User',
};

/**
 * Archetype Description Mapping
 */
export const ARCHETYPE_DESCRIPTIONS = {
  [USER_ARCHETYPES.INTERACTIVE_DEVELOPER]:
    'Users who occupy clusters for extended periods via SSH or Jupyter for code development or debugging. GPUs are mostly idle.',
  [USER_ARCHETYPES.BATCH_TRAINER]:
    'Core user group that uses the platform most ideally. Wisely utilizes Spot instance auto-recovery features.',
  [USER_ARCHETYPES.COST_OPTIMIZER]:
    'Power users who maximize SkyPilot core value (3-6x cost savings). Utilizes flexible GPU options.',
  [USER_ARCHETYPES.HOG_USER]:
    'Users who occupy expensive resources and leave them idle, causing resource starvation for other users.',
  [USER_ARCHETYPES.WAITING_USER]:
    'Strong signal indicating insufficient absolute GPU capacity or inefficient scheduling system.',
};

/**
 * Analyze user patterns based on monthly report data
 * @param {Array} monthlyData - Monthly report data array
 * @returns {Object} User-specific Archetype classification results
 */
export function analyzeUserArchetypes(monthlyData) {
  const userStats = {};

  // Aggregate statistics by user
  monthlyData.forEach((record) => {
    const userId = record.user_id || record.user_hash;
    if (!userId) return;

    if (!userStats[userId]) {
      userStats[userId] = {
        user_id: userId,
        user_name: record.user_name || userId,
        project_id: record.project_id || 'default',
        total_jobs: 0,
        interactive_jobs: 0,
        batch_jobs: 0,
        total_cost: 0,
        total_execution_time: 0,
        total_idle_time: 0,
        total_queue_time: 0,
        avg_gpu_utilization: 0,
        spot_ratio: 0,
        preemption_count: 0,
        high_end_gpu_requests: 0,
        gpu_utilization_sum: 0,
        spot_requests: 0,
        total_requests: 0,
        jobs: [],
      };
    }

    const stats = userStats[userId];
    stats.total_jobs += 1;
    stats.total_cost += record.total_cost_usd || 0;
    stats.total_execution_time += record.total_execution_time_seconds || 0;
    stats.total_idle_time += record.total_idle_time_seconds || 0;
    stats.total_queue_time += record.total_queue_time_seconds || 0;
    stats.preemption_count += record.preemption_count || 0;
    stats.jobs.push(record);

    // Classify Job Type
    if (record.job_type === 'Interactive' || record.job_type === 'sky launch') {
      stats.interactive_jobs += 1;
    } else if (
      record.job_type === 'Managed Batch' ||
      record.job_type === 'sky jobs launch'
    ) {
      stats.batch_jobs += 1;
    }

    // Aggregate GPU utilization
    stats.gpu_utilization_sum += Math.max(
      0,
      record.avg_gpu_utilization_pct || 0
    );

    // Calculate Spot instance ratio
    if (record.requested_instance_type === 'Spot') {
      stats.spot_requests += 1;
    }
    stats.total_requests += 1;

    // Check for high-end GPU requests (H100, A100, etc.)
    const gpuType = record.requested_gpu_type || '';
    if (gpuType.includes('H100') || gpuType.includes('A100')) {
      stats.high_end_gpu_requests += 1;
    }
  });

  // Calculate averages and classify Archetypes
  const userArchetypes = {};
  Object.keys(userStats).forEach((userId) => {
    const stats = userStats[userId];
    const avgGpuUtil =
      stats.total_jobs > 0 ? stats.gpu_utilization_sum / stats.total_jobs : 0;
    stats.avg_gpu_utilization = avgGpuUtil;
    stats.spot_ratio =
      stats.total_requests > 0 ? stats.spot_requests / stats.total_requests : 0;

    // Archetype classification logic
    const interactiveRatio =
      stats.total_jobs > 0 ? stats.interactive_jobs / stats.total_jobs : 0;
    const batchRatio =
      stats.total_jobs > 0 ? stats.batch_jobs / stats.total_jobs : 0;
    const idleRatio =
      stats.total_execution_time > 0
        ? stats.total_idle_time / stats.total_execution_time
        : 0;

    let archetype = null;
    let confidence = 0;

    // 1. The Interactive Developer
    if (
      interactiveRatio > 0.6 &&
      avgGpuUtil < 20 &&
      idleRatio > 0.3 &&
      stats.total_execution_time > 3600
    ) {
      archetype = USER_ARCHETYPES.INTERACTIVE_DEVELOPER;
      confidence = Math.min(
        1,
        0.5 + (interactiveRatio - 0.6) * 0.5 + ((20 - avgGpuUtil) / 20) * 0.2
      );
    }
    // 2. The Batch Trainer
    else if (batchRatio > 0.7 && avgGpuUtil >= 80 && stats.total_jobs >= 5) {
      archetype = USER_ARCHETYPES.BATCH_TRAINER;
      confidence = Math.min(
        1,
        0.6 + (batchRatio - 0.7) * 0.3 + ((avgGpuUtil - 80) / 20) * 0.2
      );
    }
    // 3. The Cost Optimizer
    else if (stats.spot_ratio > 0.8 && stats.total_jobs >= 3) {
      archetype = USER_ARCHETYPES.COST_OPTIMIZER;
      confidence = Math.min(1, 0.5 + (stats.spot_ratio - 0.8) * 2);
    }
    // 4. The "Hog" User
    else if (
      stats.high_end_gpu_requests > 0 &&
      avgGpuUtil < 15 &&
      stats.total_cost > 100
    ) {
      archetype = USER_ARCHETYPES.HOG_USER;
      confidence = Math.min(
        1,
        0.4 +
          ((15 - avgGpuUtil) / 15) * 0.3 +
          Math.min(stats.total_cost / 500, 0.3)
      );
    }
    // 5. The "Waiting" User
    else if (
      stats.total_queue_time > stats.total_execution_time * 0.5 &&
      stats.total_jobs >= 2
    ) {
      archetype = USER_ARCHETYPES.WAITING_USER;
      confidence = Math.min(
        1,
        0.4 +
          (stats.total_queue_time / stats.total_execution_time - 0.5) * 2 * 0.4
      );
    }

    userArchetypes[userId] = {
      ...stats,
      archetype: archetype || USER_ARCHETYPES.INTERACTIVE_DEVELOPER, // Default value
      confidence: confidence || 0.3,
    };
  });

  return userArchetypes;
}

/**
 * Generate archetype-specific explanation with calculation method and conditions
 * @param {string} archetype - The archetype type
 * @returns {React.ReactElement} Detailed explanation for the archetype
 */
export function getArchetypeExplanation(archetype) {
  let content = [];

  // Get the base description
  const description =
    ARCHETYPE_DESCRIPTIONS[archetype] || 'No description available';
  content.push(
    React.createElement('div', { key: 'desc', className: 'mb-3 text-sm' }, [
      description,
    ])
  );

  content.push(
    React.createElement(
      'div',
      { key: 'calc-title', className: 'font-semibold mb-2 mt-3 border-t pt-2' },
      ['Confidence Calculation:']
    )
  );

  switch (archetype) {
    case USER_ARCHETYPES.INTERACTIVE_DEVELOPER:
      content.push(
        React.createElement(
          'div',
          { key: 'formula', className: 'text-sm mb-2' },
          [
            'Base: 0.5',
            React.createElement('br'),
            '+ (Interactive Ratio - 0.6) × 0.5',
            React.createElement('br'),
            '+ ((20% - GPU Utilization) / 20%) × 0.2',
          ]
        )
      );
      content.push(
        React.createElement(
          'div',
          { key: 'conditions', className: 'text-xs text-gray-400 mt-2' },
          [
            'Conditions: Interactive jobs > 60%, GPU utilization < 20%, Total execution time > 1 hour',
          ]
        )
      );
      break;

    case USER_ARCHETYPES.BATCH_TRAINER:
      content.push(
        React.createElement(
          'div',
          { key: 'formula', className: 'text-sm mb-2' },
          [
            'Base: 0.6',
            React.createElement('br'),
            '+ (Batch Ratio - 0.7) × 0.3',
            React.createElement('br'),
            '+ ((GPU Utilization - 80%) / 20%) × 0.2',
          ]
        )
      );
      content.push(
        React.createElement(
          'div',
          { key: 'conditions', className: 'text-xs text-gray-400 mt-2' },
          [
            'Conditions: Batch jobs > 70%, GPU utilization ≥ 80%, Total jobs ≥ 5',
          ]
        )
      );
      break;

    case USER_ARCHETYPES.COST_OPTIMIZER:
      content.push(
        React.createElement(
          'div',
          { key: 'formula', className: 'text-sm mb-2' },
          [
            'Base: 0.5',
            React.createElement('br'),
            '+ (Spot Instance Ratio - 0.8) × 2',
          ]
        )
      );
      content.push(
        React.createElement(
          'div',
          { key: 'conditions', className: 'text-xs text-gray-400 mt-2' },
          ['Conditions: Spot instance ratio > 80%, Total jobs ≥ 3']
        )
      );
      break;

    case USER_ARCHETYPES.HOG_USER:
      content.push(
        React.createElement(
          'div',
          { key: 'formula', className: 'text-sm mb-2' },
          [
            'Base: 0.4',
            React.createElement('br'),
            '+ ((15% - GPU Utilization) / 15%) × 0.3',
            React.createElement('br'),
            '+ min(Total Cost / 500, 0.3)',
          ]
        )
      );
      content.push(
        React.createElement(
          'div',
          { key: 'conditions', className: 'text-xs text-gray-400 mt-2' },
          [
            'Conditions: High-end GPU requests (H100, A100), GPU utilization < 15%, Total cost > $100',
          ]
        )
      );
      break;

    case USER_ARCHETYPES.WAITING_USER:
      content.push(
        React.createElement(
          'div',
          { key: 'formula', className: 'text-sm mb-2' },
          [
            'Base: 0.4',
            React.createElement('br'),
            '+ ((Queue Time / Execution Time - 0.5) × 2) × 0.4',
          ]
        )
      );
      content.push(
        React.createElement(
          'div',
          { key: 'conditions', className: 'text-xs text-gray-400 mt-2' },
          ['Conditions: Queue time > execution time × 0.5, Total jobs ≥ 2']
        )
      );
      break;

    default:
      content.push(
        React.createElement(
          'div',
          { key: 'default', className: 'text-sm mb-2' },
          [
            'Default: 0.3 (30%)',
            React.createElement('br'),
            'Applied when no archetype conditions are met',
          ]
        )
      );
  }

  return React.createElement(
    'div',
    { className: 'text-left whitespace-normal max-w-md' },
    content
  );
}

/**
 * Generate confidence calculation explanation
 * @returns {React.ReactElement} General explanation of confidence calculation
 */
export function getConfidenceExplanation() {
  let content = [];

  content.push(
    React.createElement('div', { key: 'title', className: 'font-bold mb-2' }, [
      'Confidence Score',
    ])
  );
  content.push(
    React.createElement('div', { key: 'desc', className: 'mb-3 text-sm' }, [
      'Confidence represents how certain the system is about classifying a user into a specific archetype. The score ranges from 0 to 1 (0% to 100%).',
    ])
  );

  content.push(
    React.createElement(
      'div',
      { key: 'calc-title', className: 'font-semibold mb-2 mt-3' },
      ['Calculation Methods by Archetype:']
    )
  );

  // Interactive Developer
  content.push(
    React.createElement(
      'div',
      { key: 'interactive-title', className: 'font-semibold mt-2 mb-1' },
      ['1. Interactive Developer']
    )
  );
  content.push(
    React.createElement(
      'div',
      { key: 'interactive-formula', className: 'text-sm mb-1' },
      [
        'Base: 0.5',
        React.createElement('br'),
        '+ (Interactive Ratio - 0.6) × 0.5',
        React.createElement('br'),
        '+ ((20% - GPU Utilization) / 20%) × 0.2',
      ]
    )
  );
  content.push(
    React.createElement(
      'div',
      {
        key: 'interactive-conditions',
        className: 'text-xs text-gray-400 mb-2',
      },
      [
        'Conditions: Interactive jobs > 60%, GPU utilization < 20%, Total execution time > 1 hour',
      ]
    )
  );

  // Batch Trainer
  content.push(
    React.createElement(
      'div',
      { key: 'batch-title', className: 'font-semibold mt-2 mb-1' },
      ['2. Batch Trainer']
    )
  );
  content.push(
    React.createElement(
      'div',
      { key: 'batch-formula', className: 'text-sm mb-1' },
      [
        'Base: 0.6',
        React.createElement('br'),
        '+ (Batch Ratio - 0.7) × 0.3',
        React.createElement('br'),
        '+ ((GPU Utilization - 80%) / 20%) × 0.2',
      ]
    )
  );
  content.push(
    React.createElement(
      'div',
      { key: 'batch-conditions', className: 'text-xs text-gray-400 mb-2' },
      ['Conditions: Batch jobs > 70%, GPU utilization ≥ 80%, Total jobs ≥ 5']
    )
  );

  // Cost Optimizer
  content.push(
    React.createElement(
      'div',
      { key: 'cost-title', className: 'font-semibold mt-2 mb-1' },
      ['3. Cost Optimizer']
    )
  );
  content.push(
    React.createElement(
      'div',
      { key: 'cost-formula', className: 'text-sm mb-1' },
      [
        'Base: 0.5',
        React.createElement('br'),
        '+ (Spot Instance Ratio - 0.8) × 2',
      ]
    )
  );
  content.push(
    React.createElement(
      'div',
      { key: 'cost-conditions', className: 'text-xs text-gray-400 mb-2' },
      ['Conditions: Spot instance ratio > 80%, Total jobs ≥ 3']
    )
  );

  // Hog User
  content.push(
    React.createElement(
      'div',
      { key: 'hog-title', className: 'font-semibold mt-2 mb-1' },
      ['4. Resource Hog']
    )
  );
  content.push(
    React.createElement(
      'div',
      { key: 'hog-formula', className: 'text-sm mb-1' },
      [
        'Base: 0.4',
        React.createElement('br'),
        '+ ((15% - GPU Utilization) / 15%) × 0.3',
        React.createElement('br'),
        '+ min(Total Cost / 500, 0.3)',
      ]
    )
  );
  content.push(
    React.createElement(
      'div',
      { key: 'hog-conditions', className: 'text-xs text-gray-400 mb-2' },
      [
        'Conditions: High-end GPU requests (H100, A100), GPU utilization < 15%, Total cost > $100',
      ]
    )
  );

  // Waiting User
  content.push(
    React.createElement(
      'div',
      { key: 'waiting-title', className: 'font-semibold mt-2 mb-1' },
      ['5. Waiting User']
    )
  );
  content.push(
    React.createElement(
      'div',
      { key: 'waiting-formula', className: 'text-sm mb-1' },
      [
        'Base: 0.4',
        React.createElement('br'),
        '+ ((Queue Time / Execution Time - 0.5) × 2) × 0.4',
      ]
    )
  );
  content.push(
    React.createElement(
      'div',
      { key: 'waiting-conditions', className: 'text-xs text-gray-400 mb-2' },
      ['Conditions: Queue time > execution time × 0.5, Total jobs ≥ 2']
    )
  );

  // Default
  content.push(
    React.createElement(
      'div',
      { key: 'default-title', className: 'font-semibold mt-2 mb-1' },
      ['Default']
    )
  );
  content.push(
    React.createElement(
      'div',
      { key: 'default-value', className: 'text-sm mb-1' },
      [
        'Default: 0.3 (30%)',
        React.createElement('br'),
        'Applied when no archetype conditions are met',
      ]
    )
  );

  return React.createElement(
    'div',
    { className: 'text-left whitespace-normal max-w-lg' },
    content
  );
}

/**
 * Generate custom guidelines for users
 * @param {Object} userStats - User statistics and Archetype information
 * @returns {Array} Guideline array
 */
export function generateUserGuidelines(userStats) {
  const guidelines = [];
  const { archetype, avg_gpu_utilization, total_idle_time } = userStats;

  switch (archetype) {
    case USER_ARCHETYPES.INTERACTIVE_DEVELOPER:
      if (total_idle_time > 3600) {
        guidelines.push({
          type: 'warning',
          title: 'Autostop Configuration Recommended',
          message:
            'Total_Idle_Time is high. Strongly recommend using sky launch --idle-minutes-to-autostop=30 command.',
          action: 'sky launch --idle-minutes-to-autostop=30',
        });
      }
      guidelines.push({
        type: 'info',
        title: 'Use Managed Jobs',
        message:
          'For long-running tasks, use sky jobs launch instead of sky launch.',
      });
      break;

    case USER_ARCHETYPES.BATCH_TRAINER:
      guidelines.push({
        type: 'success',
        title: 'Optimal Usage Pattern',
        message:
          'Your current usage pattern efficiently utilizes the platform. Please continue to maintain it.',
      });
      break;

    case USER_ARCHETYPES.COST_OPTIMIZER:
      guidelines.push({
        type: 'success',
        title: 'Excellent Cost Optimization',
        message:
          'You are actively utilizing Spot instances. Do not hardcode specific GPUs, provide multiple options instead.',
      });
      guidelines.push({
        type: 'info',
        title: 'Expand GPU Options',
        message:
          'Provide multiple options as an array in YAML file, e.g., accelerators: [A100:8, H100:8, A10g:8].',
      });
      break;

    case USER_ARCHETYPES.HOG_USER:
      guidelines.push({
        type: 'error',
        title: 'Resource Usage Optimization Required',
        message:
          'You are requesting expensive GPUs but utilization is low. Profile first with Fractional GPU or smaller GPUs.',
      });
      guidelines.push({
        type: 'warning',
        title: 'Autostop Required',
        message:
          'Do not leave idle resources. Set autostop or terminate the cluster when work is complete.',
      });
      break;

    case USER_ARCHETYPES.WAITING_USER:
      guidelines.push({
        type: 'warning',
        title: 'Excessive Wait Time',
        message:
          'Queue wait time is longer than execution time, indicating platform capacity shortage. Please contact administrator.',
      });
      break;

    default:
      if (avg_gpu_utilization < 30) {
        guidelines.push({
          type: 'info',
          title: 'Improve GPU Utilization',
          message: 'GPU utilization is low. Consider optimizing your workload.',
        });
      }
  }

  return guidelines;
}

/**
 * Generate platform improvement suggestions
 * @param {Object} aggregatedStats - Overall statistics information
 * @returns {Array} Improvement suggestion array
 */
export function generatePlatformImprovements(aggregatedStats) {
  const improvements = [];

  // If Interactive Developer ratio is high
  if (aggregatedStats.interactive_ratio > 0.4) {
    improvements.push({
      priority: 'high',
      title: 'Idle Resource Auto-Reclamation Policy',
      description:
        'Implement a policy to force autostop or delete Interactive Pods with Avg_GPU_Utilization_Pct below 5% for more than 1 hour.',
      category: 'Policy',
    });
  }

  // If Waiting User ratio is high
  if (aggregatedStats.waiting_ratio > 0.2) {
    improvements.push({
      priority: 'high',
      title: 'K8s Kueue and DWS Integration',
      description:
        'Integrate Kubernetes Kueue with SkyPilot to implement dynamic GPU provisioning.',
      category: 'Scheduling',
    });
  }

  // If Hog User exists
  if (aggregatedStats.hog_count > 0) {
    improvements.push({
      priority: 'medium',
      title: 'Quota System Implementation',
      description:
        'Apply monthly budget limits and concurrent GPU quota per User_ID or Project_ID.',
      category: 'Control',
    });
  }

  // If overall GPU utilization is low
  if (aggregatedStats.avg_gpu_utilization < 50) {
    improvements.push({
      priority: 'medium',
      title: 'User Dashboard Construction',
      description:
        'Provide user-specific custom dashboards using Grafana to encourage self-correction.',
      category: 'Observability',
    });
  }

  return improvements;
}
