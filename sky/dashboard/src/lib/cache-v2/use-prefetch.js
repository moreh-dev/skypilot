import { usePrefetchQuery } from '@tanstack/react-query';
import { getClusterHistory, getClusters } from '@/data/connectors/clusters';
import { getWorkspaces } from '@/data/connectors/workspaces';
import { queryKey } from '@/lib/cache-v2';

function usePrefetch() {
  usePrefetchQuery({
    queryKey: queryKey.clusters.list(),
    queryFn: () => getClusters(),
  });
  usePrefetchQuery({
    queryKey: queryKey.clusterHistories.list({ days: 1 }),
    queryFn: () => getClusterHistory(null, 1),
  });
}

export default usePrefetch;
