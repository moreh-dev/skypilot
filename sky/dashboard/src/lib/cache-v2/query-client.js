import { QueryClient } from '@tanstack/react-query';
import { CACHE_CONFIG, REFRESH_INTERVALS } from '@/lib/config';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: CACHE_CONFIG.DEFAULT_TTL,
      gcTime: CACHE_CONFIG.DEFAULT_TTL,
      refetchInterval: REFRESH_INTERVALS.REFRESH_INTERVAL,
      refetchOnWindowFocus: true,
    },
  },
});

export default queryClient;
