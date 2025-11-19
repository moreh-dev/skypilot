/**
 * Cluster database schema type definition
 * Based on PostgreSQL schema:
 * CREATE TABLE public.clusters (
 *   name text NOT NULL,
 *   launched_at int4 NULL,
 *   handle bytea NULL,
 *   last_use text NULL,
 *   status text NULL,
 *   autostop int4 DEFAULT '-1'::integer NULL,
 *   to_down int4 DEFAULT 0 NULL,
 *   metadata text DEFAULT '{}'::text NULL,
 *   "owner" text NULL,
 *   cluster_hash text NULL,
 *   storage_mounts_metadata bytea NULL,
 *   cluster_ever_up int4 DEFAULT 0 NULL,
 *   status_updated_at int4 NULL,
 *   config_hash text NULL,
 *   user_hash text NULL,
 *   workspace text DEFAULT 'default'::text NULL,
 *   last_creation_yaml text NULL,
 *   last_creation_command text NULL,
 *   is_managed int4 DEFAULT 0 NULL,
 *   provision_log_path text NULL,
 *   skylet_ssh_tunnel_metadata bytea NULL,
 *   CONSTRAINT clusters_pkey PRIMARY KEY (name)
 * );
 */

/**
 * Raw cluster data from database
 * This represents the exact schema from the database
 */
export interface ClusterDatabaseSchema {
  /** Cluster name (primary key, NOT NULL) */
  name: string;
  /** Unix timestamp when cluster was launched (nullable) */
  launched_at: number | null;
  /** Binary handle data (nullable) */
  handle: Uint8Array | null;
  /** Last use timestamp as text (nullable) */
  last_use: string | null;
  /** Cluster status (nullable) */
  status: string | null;
  /** Autostop configuration in minutes, -1 means disabled (default: -1, nullable) */
  autostop: number | null;
  /** Whether to down the cluster (default: 0, nullable) */
  to_down: number | null;
  /** Metadata as JSON string (default: '{}', nullable) */
  metadata: string | null;
  /** Cluster owner (nullable) */
  owner: string | null;
  /** Unique cluster hash identifier (nullable) */
  cluster_hash: string | null;
  /** Storage mounts metadata as binary (nullable) */
  storage_mounts_metadata: Uint8Array | null;
  /** Whether cluster was ever up (default: 0, nullable) */
  cluster_ever_up: number | null;
  /** Unix timestamp when status was last updated (nullable) */
  status_updated_at: number | null;
  /** Configuration hash (nullable) */
  config_hash: string | null;
  /** User hash identifier (nullable) */
  user_hash: string | null;
  /** Workspace name (default: 'default', nullable) */
  workspace: string | null;
  /** Last creation YAML content (nullable) */
  last_creation_yaml: string | null;
  /** Last creation command (nullable) */
  last_creation_command: string | null;
  /** Whether cluster is managed (default: 0, nullable) */
  is_managed: number | null;
  /** Provision log file path (nullable) */
  provision_log_path: string | null;
  /** Skylet SSH tunnel metadata as binary (nullable) */
  skylet_ssh_tunnel_metadata: Uint8Array | null;
}

/**
 * Extended cluster data used in the frontend
 * This includes transformed fields and additional computed properties
 */
export interface Cluster
  extends Omit<Partial<ClusterDatabaseSchema>, 'to_down'> {
  /** Cluster name */
  cluster?: string;
  /** User name */
  user?: string;
  /** User hash */
  user_hash?: string;
  /** Cluster hash */
  cluster_hash?: string;
  /** Cloud provider */
  cloud?: string;
  /** Region */
  region?: string;
  /** Infrastructure display string */
  infra?: string;
  /** Full infrastructure string */
  full_infra?: string;
  /** CPU count */
  cpus?: number;
  /** Memory */
  mem?: number;
  /** GPU/Accelerator information */
  gpus?: any;
  /** Resources string (short) */
  resources_str?: string;
  /** Resources string (full) */
  resources_str_full?: string;
  /** Launch time as Date object */
  time?: Date | null;
  /** Number of nodes */
  num_nodes?: number;
  /** Workspace */
  workspace?: string;
  /** Autostop value */
  autostop?: number;
  /** Last event */
  last_event?: any;
  /** To down flag (can be boolean or number in frontend) */
  to_down?: boolean | number;
  /** Cluster name on cloud */
  cluster_name_on_cloud?: string | null;
  /** Jobs array */
  jobs?: any[];
  /** Command used to create cluster */
  command?: string;
  /** Task YAML */
  task_yaml?: string;
  /** Events array */
  events?: Array<{ time: Date; event: string }>;
  /** Duration in seconds */
  duration?: number;
  /** Total cost */
  total_cost?: number;
  /** Usage intervals */
  usage_intervals?: any;
  /** Status */
  status?: string;
  /** Submitted at timestamp */
  submitted_at?: Date | null;
  /** End time timestamp */
  end_time?: Date | null;
  /** Queue time in seconds */
  queue_time?: number | null;
  /** Recoveries count */
  recoveries?: number;
}

/**
 * Cluster history database schema type definition
 * Based on PostgreSQL schema:
 * CREATE TABLE public.cluster_history (
 *   cluster_hash text NOT NULL,
 *   "name" text NULL,
 *   num_nodes int4 NULL,
 *   requested_resources bytea NULL,
 *   launched_resources bytea NULL,
 *   usage_intervals bytea NULL,
 *   user_hash text NULL,
 *   last_creation_yaml text NULL,
 *   last_creation_command text NULL,
 *   workspace text NULL,
 *   provision_log_path text NULL,
 *   CONSTRAINT cluster_history_pkey PRIMARY KEY (cluster_hash)
 * );
 */

/**
 * Raw cluster history data from database
 * This represents the exact schema from the cluster_history table
 */
export interface ClusterHistoryDatabaseSchema {
  /** Cluster hash (primary key, NOT NULL) */
  cluster_hash: string;
  /** Cluster name (nullable) */
  name: string | null;
  /** Number of nodes (nullable) */
  num_nodes: number | null;
  /** Requested resources as binary data (nullable) */
  requested_resources: Uint8Array | null;
  /** Launched resources as binary data (nullable) */
  launched_resources: Uint8Array | null;
  /** Usage intervals as binary data (nullable) */
  usage_intervals: Uint8Array | null;
  /** User hash identifier (nullable) */
  user_hash: string | null;
  /** Last creation YAML content (nullable) */
  last_creation_yaml: string | null;
  /** Last creation command (nullable) */
  last_creation_command: string | null;
  /** Workspace name (nullable) */
  workspace: string | null;
  /** Provision log file path (nullable) */
  provision_log_path: string | null;
}

/**
 * Extended cluster history data used in the frontend
 * This includes transformed fields and additional computed properties
 */
export interface ClusterHistory extends Partial<ClusterHistoryDatabaseSchema> {
  /** Cluster hash (primary key) */
  cluster_hash?: string;
  /** Cluster name */
  cluster?: string;
  /** User name */
  user?: string;
  /** User hash */
  user_hash?: string;
  /** Cloud provider */
  cloud?: string;
  /** Region */
  region?: string;
  /** Infrastructure display string */
  infra?: string;
  /** Full infrastructure string */
  full_infra?: string;
  /** Resources string (short) */
  resources_str?: string;
  /** Resources string (full) */
  resources_str_full?: string;
  /** Launch time as Date object */
  time?: Date | null;
  /** Number of nodes */
  num_nodes?: number;
  /** Duration in seconds */
  duration?: number;
  /** Total cost */
  total_cost?: number;
  /** Workspace */
  workspace?: string;
  /** Status */
  status?: string;
  /** Last event */
  last_event?: any;
  /** Cluster name on cloud */
  cluster_name_on_cloud?: string | null;
  /** Command used to create cluster */
  command?: string;
  /** Task YAML */
  task_yaml?: string;
  /** Events array */
  events?: Array<{ time: Date; event: string }>;
  /** Usage intervals (parsed from binary) */
  usage_intervals?: any;
  /** To down flag */
  to_down?: boolean | number;
  /** Autostop value */
  autostop?: number;
}
