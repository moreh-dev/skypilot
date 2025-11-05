'use client';
/* global process */

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import PropTypes from 'prop-types';
import '@/app/globals.css';
import { BASE_PATH } from '@/data/connectors/constants';
import { TourProvider } from '@/hooks/useTour';
import { QueryClientProvider } from '@tanstack/react-query';
import { Prefetch, queryClient } from '@/lib/cache-v2';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

const Layout = dynamic(
  () => import('@/components/elements/layout').then((mod) => mod.Layout),
  { ssr: false }
);

function App({ Component, pageProps }) {
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = `${BASE_PATH}/favicon.ico`;
    document.head.appendChild(link);
  }, []);

  return (
    <TourProvider>
      <QueryClientProvider client={queryClient}>
        <Prefetch>
          <Layout highlighted={pageProps.highlighted}>
            <Component {...pageProps} />
          </Layout>
        </Prefetch>
        {process.env.NODE_ENV === 'development' && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </QueryClientProvider>
    </TourProvider>
  );
}

App.propTypes = {
  Component: PropTypes.elementType.isRequired,
  pageProps: PropTypes.object.isRequired,
};

export default App;
