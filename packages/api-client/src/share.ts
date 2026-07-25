import {
  canonicalizeUrl,
  extractFirstUrl,
  type FeedItemRow,
  type SourceType,
} from '@jobdrop/contracts';
import type { JobDropClient } from './client';

export type ShareInput = {
  clientShareId: string;
  sourceType: SourceType;
  rawInput: string;
  canonicalUrl?: string | null;
  urlHash?: string | null;
  contentHash?: string | null;
  note?: string | null;
  /** Omit for the default path: every group the sharer belongs to. */
  groupIds?: string[] | null;
};

export type ShareResult = {
  jobPostId: string;
  groupCount: number;
  deduped: boolean;
};

/** SHA-256 hex. Injected because RN needs expo-crypto and Node has node:crypto. */
export type Sha256 = (input: string) => Promise<string>;

/**
 * Work out what a raw paste actually is.
 *
 * A share must never be rejected for being the wrong shape — doc 1 §5.1. Text
 * containing a link is treated as a link share (the URL is the identity we can
 * dedupe on) while keeping the full text as raw_input for the parser.
 */
export async function buildShareInput(
  raw: string,
  sha256: Sha256,
  opts: { clientShareId: string; note?: string | null; groupIds?: string[] | null } = {
    clientShareId: '',
  },
): Promise<ShareInput> {
  const trimmed = raw.trim();
  const url = canonicalizeUrl(trimmed) ?? canonicalizeUrl(extractFirstUrl(trimmed) ?? '');

  if (url) {
    return {
      clientShareId: opts.clientShareId,
      sourceType: 'link',
      rawInput: trimmed,
      canonicalUrl: url,
      urlHash: await sha256(url),
      note: opts.note ?? null,
      groupIds: opts.groupIds ?? null,
    };
  }

  // No URL: a pasted JD. Normalise whitespace before hashing so the same JD
  // forwarded twice with different line wrapping still collapses.
  const normalised = trimmed.replace(/\s+/g, ' ').toLowerCase();
  return {
    clientShareId: opts.clientShareId,
    sourceType: 'text',
    rawInput: trimmed,
    contentHash: await sha256(normalised),
    note: opts.note ?? null,
    groupIds: opts.groupIds ?? null,
  };
}

/**
 * Broadcast. One round trip that creates or reuses the job, delivers it to every
 * group, and queues enrichment — see share_job in 0014_share_rpc.sql.
 */
export async function shareJob(client: JobDropClient, input: ShareInput): Promise<ShareResult> {
  const { data, error } = await client.rpc('share_job', {
    p_client_share_id: input.clientShareId,
    p_source_type: input.sourceType,
    p_raw_input: input.rawInput,
    p_canonical_url: input.canonicalUrl ?? null,
    p_url_hash: input.urlHash ?? null,
    p_content_hash: input.contentHash ?? null,
    p_note: input.note ?? null,
    p_group_ids: input.groupIds ?? null,
  });

  if (error) throw new Error(`share: ${error.message}`);

  const row = data?.[0];
  if (!row) throw new Error('share: no result returned');

  return {
    jobPostId: row.job_post_id,
    groupCount: row.group_count,
    deduped: row.deduped,
  };
}

export const FEED_PAGE_SIZE = 30;

/** The unified feed: one row per job, collapsed across the caller's groups. */
export async function listFeed(
  client: JobDropClient,
  opts: { before?: string; limit?: number } = {},
): Promise<FeedItemRow[]> {
  let query = client
    .from('feed_items')
    .select('*')
    .order('last_shared_at', { ascending: false })
    .limit(opts.limit ?? FEED_PAGE_SIZE);

  if (opts.before) query = query.lt('last_shared_at', opts.before);

  const { data, error } = await query;
  if (error) throw new Error(`load feed: ${error.message}`);
  return data ?? [];
}

/**
 * What to show on a card before enrichment has run, and after it fails. A card
 * is never blank: worst case it is the hostname and the raw link.
 */
export function jobDisplayTitle(item: {
  title: string | null;
  canonical_url: string | null;
  raw_input: string | null;
  source_site: string | null;
}): string {
  if (item.title) return item.title;
  if (item.source_site) return item.source_site;

  if (item.canonical_url) {
    try {
      return new URL(item.canonical_url).hostname.replace(/^www\./, '');
    } catch {
      // fall through
    }
  }
  const raw = item.raw_input?.trim() ?? '';
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw || 'Shared job';
}
