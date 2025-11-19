import React from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';

const Report = dynamic(
  () => import('@/components/report').then((mod) => mod.Report),
  { ssr: false }
);

export default function ReportPage() {
  return (
    <>
      <Head>
        <title>Report | SkyPilot Dashboard</title>
      </Head>
      <Report />
    </>
  );
}
