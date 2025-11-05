const queryKey = {
  all: () => [],

  clusters: {
    all: () => [...queryKey.all(), 'clusters'],

    list: ({ clusterNames = null } = {}) => [
      ...queryKey.clusters.all(),
      'list',
      { clusterNames },
    ],
  },

  clusterHistories: {
    all: () => [...queryKey.all(), 'cluster-histories'],

    list: ({ clusterhash = null, days = 30 } = {}) => [
      ...queryKey.clusterHistories.all(),
      'list',
      { clusterhash, days },
    ],
  },
};

export default queryKey;
