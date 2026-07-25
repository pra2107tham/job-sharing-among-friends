import type { MessageWithRelations } from '@jobdrop/contracts';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { JobDropClient } from './client';
import { must } from './util';

const MESSAGE_SELECT = '*, sender:profiles(id, display_name, handle, avatar_url), job:job_posts(*)';

export const MESSAGE_PAGE_SIZE = 40;

/**
 * A page of group history, newest first.
 *
 * Paginated by timestamp rather than offset: new messages arrive constantly, and
 * an offset would make older pages shift under the reader.
 */
export async function listGroupMessages(
  client: JobDropClient,
  groupId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<MessageWithRelations[]> {
  let query = client
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? MESSAGE_PAGE_SIZE);

  if (opts.before) query = query.lt('created_at', opts.before);

  const { data, error } = await query;
  if (error) throw new Error(`load messages: ${error.message}`);
  return (data ?? []) as unknown as MessageWithRelations[];
}

export async function sendGroupMessage(
  client: JobDropClient,
  args: { groupId: string; senderId: string; body: string; clientMsgId: string },
): Promise<MessageWithRelations> {
  const { data, error } = await client
    .from('messages')
    .insert({
      group_id: args.groupId,
      sender_id: args.senderId,
      kind: 'text',
      body: args.body,
      client_msg_id: args.clientMsgId,
    })
    .select(MESSAGE_SELECT)
    .single();

  return must(data, error, 'send message') as unknown as MessageWithRelations;
}

/**
 * Live updates for one group.
 *
 * Realtime re-applies RLS per subscriber, so this cannot deliver a message the
 * user could not have read anyway. The payload is a bare row without the
 * embedded sender/job, so the caller refetches that one message — cheaper and
 * simpler than trying to keep a join in sync by hand.
 */
export function subscribeToGroup(
  client: JobDropClient,
  groupId: string,
  onMessage: (messageId: string) => void,
): RealtimeChannel {
  return client
    .channel(`group:${groupId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}` },
      (payload) => {
        const id = (payload.new as { id?: string }).id;
        if (id) onMessage(id);
      },
    )
    .subscribe();
}

export async function getMessage(
  client: JobDropClient,
  messageId: string,
): Promise<MessageWithRelations | null> {
  const { data, error } = await client
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('id', messageId)
    .maybeSingle();

  if (error) throw new Error(`load message: ${error.message}`);
  return data as unknown as MessageWithRelations | null;
}

/**
 * Enrichment updates a job_post in place after the optimistic send (doc 1
 * §4.3), so a card that is currently a bare URL upgrades itself without the
 * user refreshing.
 */
export function subscribeToJobUpdates(
  client: JobDropClient,
  onJobUpdated: (jobPostId: string) => void,
): RealtimeChannel {
  return client
    .channel('job_posts:updates')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'job_posts' },
      (payload) => {
        const id = (payload.new as { id?: string }).id;
        if (id) onJobUpdated(id);
      },
    )
    .subscribe();
}
