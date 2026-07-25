/**
 * Database types for the `public` schema.
 *
 * Hand-written to mirror supabase/migrations/*.sql. Regenerate with
 * `pnpm db:types` once Docker or a linked Supabase project is available —
 * `supabase gen types` shells out to a container, so it cannot run in every
 * environment. If you change a migration, change this file in the same commit.
 */

type Timestamptz = string;
type Uuid = string;

/**
 * Insert = every column optional except the ones the database genuinely
 * requires (no default, not null). Update = everything optional. This keeps the
 * three variants in sync instead of triplicating each table by hand.
 */
type Table<Row, RequiredOnInsert extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, RequiredOnInsert>;
  Update: Partial<Row>;
  Relationships: [];
};

export type WorkMode = 'onsite' | 'hybrid' | 'remote';
export type SourceType = 'link' | 'image' | 'text';
export type ParseStatus = 'pending' | 'ok' | 'partial' | 'failed';
export type MessageKind = 'text' | 'job' | 'system';
export type MemberRole = 'admin' | 'member';
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';
export type ConnectionStatus = 'pending' | 'accepted' | 'blocked';
export type Platform = 'ios' | 'android' | 'web';

/** Tracker states (doc 1 §5.2). `new` is the implicit state of an unseen job. */
export type JobStatusValue =
  'new' | 'saved' | 'applied' | 'interviewing' | 'offer' | 'rejected' | 'not_interested';

export type ProfileRow = {
  id: Uuid;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  onboarded_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

export type DeviceRow = {
  id: Uuid;
  user_id: Uuid;
  platform: Platform;
  push_token: string | null;
  app_version: string | null;
  last_seen_at: Timestamptz;
  created_at: Timestamptz;
};

export type GroupRow = {
  id: Uuid;
  name: string;
  avatar_url: string | null;
  join_code: string;
  join_code_enabled: boolean;
  created_by: Uuid | null;
  created_at: Timestamptz;
};

export type GroupMemberRow = {
  group_id: Uuid;
  user_id: Uuid;
  role: MemberRole;
  joined_at: Timestamptz;
  muted_until: Timestamptz | null;
};

export type GroupInviteRow = {
  id: Uuid;
  group_id: Uuid;
  inviter_id: Uuid;
  invitee_id: Uuid;
  status: InviteStatus;
  created_at: Timestamptz;
  responded_at: Timestamptz | null;
};

export type ConnectionRow = {
  id: Uuid;
  requester_id: Uuid;
  addressee_id: Uuid;
  status: ConnectionStatus;
  created_at: Timestamptz;
  responded_at: Timestamptz | null;
};

export type DmThreadRow = {
  id: Uuid;
  user_a: Uuid;
  user_b: Uuid;
  connection_id: Uuid;
  created_at: Timestamptz;
};

/** The shared spine (docs/03 §2). The Phase 2 agent points at this table. */
export type JobPostRow = {
  id: Uuid;
  source_type: SourceType;
  raw_input: string | null;
  canonical_url: string | null;
  url_hash: string | null;
  content_hash: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  work_mode: WorkMode | null;
  employment_type: string | null;
  experience_min: number | null;
  experience_max: number | null;
  salary_text: string | null;
  apply_url: string | null;
  apply_emails: string[];
  description: string | null;
  og_image_url: string | null;
  favicon_url: string | null;
  source_site: string | null;
  posted_at: Timestamptz | null;
  closes_at: Timestamptz | null;
  parse_status: ParseStatus;
  parse_meta: Record<string, unknown>;
  first_shared_by: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

export type JobAttachmentRow = {
  id: Uuid;
  job_post_id: Uuid;
  storage_path: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  ocr_text: string | null;
  created_at: Timestamptz;
};

export type MessageRow = {
  id: Uuid;
  group_id: Uuid | null;
  thread_id: Uuid | null;
  sender_id: Uuid | null;
  kind: MessageKind;
  body: string | null;
  job_post_id: Uuid | null;
  client_msg_id: Uuid | null;
  created_at: Timestamptz;
  edited_at: Timestamptz | null;
  deleted_at: Timestamptz | null;
};

export type ShareRow = {
  id: Uuid;
  job_post_id: Uuid;
  sharer_id: Uuid;
  group_id: Uuid;
  message_id: Uuid | null;
  note: string | null;
  client_share_id: Uuid;
  created_at: Timestamptz;
};

export type ReactionRow = {
  message_id: Uuid;
  user_id: Uuid;
  emoji: string;
  created_at: Timestamptz;
};

export type ReadStateRow = {
  user_id: Uuid;
  group_id: Uuid;
  last_read_at: Timestamptz;
};

/** Private to its owner. Never expose another user's rows (docs/03 §3.2). */
export type JobStatusRow = {
  user_id: Uuid;
  job_post_id: Uuid;
  status: JobStatusValue;
  applied_at: Timestamptz | null;
  notes: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

/** group_overview (0013). Read-only; one row per group the caller is in. */
export type GroupOverviewRow = {
  id: Uuid;
  name: string;
  avatar_url: string | null;
  join_code: string;
  created_by: Uuid | null;
  created_at: Timestamptz;
  member_count: number;
  last_message_at: Timestamptz | null;
  last_message_preview: string | null;
  last_message_sender: string | null;
  unread_count: number;
};

/** feed_items (0015). One row per job, collapsed across groups. */
export type FeedItemRow = {
  job_post_id: Uuid;
  title: string | null;
  company: string | null;
  location: string | null;
  work_mode: WorkMode | null;
  salary_text: string | null;
  canonical_url: string | null;
  apply_url: string | null;
  apply_emails: string[];
  favicon_url: string | null;
  og_image_url: string | null;
  source_site: string | null;
  source_type: SourceType;
  raw_input: string | null;
  parse_status: ParseStatus;
  job_created_at: Timestamptz;
  first_shared_at: Timestamptz;
  last_shared_at: Timestamptz;
  group_count: number;
  sharer_count: number;
  first_sharer_name: string | null;
  first_group_name: string | null;
  note: string | null;
};

/** A message with its sender and job embedded, as PostgREST returns it. */
export type MessageWithRelations = MessageRow & {
  sender: Pick<ProfileRow, 'id' | 'display_name' | 'handle' | 'avatar_url'> | null;
  job: JobPostRow | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, 'id'>;
      devices: Table<DeviceRow, 'user_id' | 'platform'>;
      groups: Table<GroupRow, 'name'>;
      group_members: Table<GroupMemberRow, 'group_id' | 'user_id'>;
      group_invites: Table<GroupInviteRow, 'group_id' | 'inviter_id' | 'invitee_id'>;
      connections: Table<ConnectionRow, 'requester_id' | 'addressee_id'>;
      dm_threads: Table<DmThreadRow, 'user_a' | 'user_b' | 'connection_id'>;
      job_posts: Table<JobPostRow, 'source_type'>;
      job_attachments: Table<JobAttachmentRow, 'job_post_id' | 'storage_path'>;
      messages: Table<MessageRow>;
      shares: Table<ShareRow, 'job_post_id' | 'sharer_id' | 'group_id' | 'client_share_id'>;
      reactions: Table<ReactionRow, 'message_id' | 'user_id' | 'emoji'>;
      read_state: Table<ReadStateRow, 'user_id' | 'group_id'>;
      job_status: Table<JobStatusRow, 'user_id' | 'job_post_id'>;
    };
    Views: {
      // Views are read-only, so Insert/Update are `never`-shaped. They still
      // have to be present for supabase-js's GenericView constraint.
      group_overview: {
        Row: GroupOverviewRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      feed_items: {
        Row: FeedItemRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Functions: {
      preview_group_by_code: {
        Args: { code: string };
        Returns: { id: Uuid; name: string; avatar_url: string | null; member_count: number }[];
      };
      join_group_by_code: {
        Args: { code: string };
        Returns: Uuid;
      };
      accept_group_invite: {
        Args: { invite: Uuid };
        Returns: Uuid;
      };
      mark_group_read: {
        Args: { p_group_id: Uuid };
        Returns: undefined;
      };
      share_job: {
        Args: {
          p_client_share_id: Uuid;
          p_source_type: SourceType;
          p_raw_input: string;
          p_canonical_url?: string | null;
          p_url_hash?: string | null;
          p_content_hash?: string | null;
          p_note?: string | null;
          p_group_ids?: Uuid[] | null;
        };
        Returns: { job_post_id: Uuid; group_count: number; deduped: boolean }[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
