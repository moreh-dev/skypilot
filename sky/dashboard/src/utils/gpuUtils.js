/**
 * GPU and Node related utility functions
 */

/**
 * Extract node count from resources_str_full or num_nodes field
 * @param {string} resourcesStrFull - The resources_str_full string
 * @param {number} numNodes - The num_nodes field value
 * @returns {number} Node count
 */
export function extractNodeCount(resourcesStrFull, numNodes) {
  // First check if num_nodes field exists
  if (numNodes && typeof numNodes === 'number') {
    return numNodes;
  }

  // Fall back to resources_str_full
  if (resourcesStrFull) {
    // Look for pattern like "2x(" at the beginning
    const nodeMatch = resourcesStrFull.match(/^(\d+)x\(/);
    if (nodeMatch) {
      return parseInt(nodeMatch[1], 10);
    }
  }

  return 1; // Default to 1 node
}

/**
 * Extract GPU info from accelerators field or resources_str_full
 * @param {any} accelerators - The accelerators field
 * @param {string} resourcesStrFull - The resources_str_full string
 * @returns {object} Object with type and count properties
 */
export function extractGPUInfo(accelerators, resourcesStrFull) {
  // First try the regular accelerators field
  if (accelerators) {
    let parsed = accelerators;
    if (typeof accelerators === 'string') {
      try {
        const jsonStr = accelerators
          .replace(/'/g, '"')
          .replace(/None/g, 'null');
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        // Fall back to resources_str_full
      }
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const entries = Object.entries(parsed);
      if (entries.length > 0) {
        return {
          type: entries[0][0],
          count: Number(entries[0][1]) || 0,
        };
      }
    }
  }

  // Fall back to resources_str_full
  if (resourcesStrFull) {
    // Look for gpus= pattern in the resources string
    const gpusMatch = resourcesStrFull.match(/gpus=([^,]+)/);
    if (gpusMatch) {
      const gpusValue = gpusMatch[1]; // e.g., "MI250:8"
      const colonIndex = gpusValue.indexOf(':');

      if (colonIndex !== -1) {
        const type = gpusValue.substring(0, colonIndex); // e.g., "MI250"
        const count = parseInt(gpusValue.substring(colonIndex + 1), 10) || 0; // e.g., 8

        return { type, count };
      }
    }
  }

  return { type: null, count: 0 };
}
