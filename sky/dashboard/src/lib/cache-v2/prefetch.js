import usePrefetch from '@/lib/cache-v2/use-prefetch';

function Prefetch({ children }) {
  usePrefetch();

  return children;
}

export default Prefetch;
