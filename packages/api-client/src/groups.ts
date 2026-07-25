import type { GroupOverviewRow, GroupRow, ProfileRow } from '@jobdrop/contracts';
import type { JobDropClient } from './client';
import { must } from './util';

/** Groups the caller belongs to, with unread counts and a last-message preview. */
export async function listGroupOverview(client: JobDropClient): Promise<GroupOverviewRow[]> {
  const { data, error } = await client
    .from('group_overview')
    .select('*')
    // Groups with activity float up; a brand new empty group still appears.
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`list groups: ${error.message}`);
  return data ?? [];
}

export async function getGroup(client: JobDropClient, groupId: string): Promise<GroupRow | null> {
  const { data, error } = await client.from('groups').select('*').eq('id', groupId).maybeSingle();
  if (error) throw new Error(`load group: ${error.message}`);
  return data;
}

export async function createGroup(
  client: JobDropClient,
  name: string,
  createdBy: string,
): Promise<GroupRow> {
  // .select() reads the row back, which only works because groups_select_member
  // also allows `created_by = auth.uid()` — the membership trigger has not run
  // yet at this point. See 0010_rls_policies.sql.
  const { data, error } = await client
    .from('groups')
    .insert({ name, created_by: createdBy })
    .select()
    .single();

  return must(data, error, 'create group');
}

export type GroupMemberWithProfile = {
  user_id: string;
  role: string;
  joined_at: string;
  profile: Pick<ProfileRow, 'id' | 'display_name' | 'handle' | 'avatar_url'> | null;
};

export async function listGroupMembers(
  client: JobDropClient,
  groupId: string,
): Promise<GroupMemberWithProfile[]> {
  const { data, error } = await client
    .from('group_members')
    .select('user_id, role, joined_at, profile:profiles(id, display_name, handle, avatar_url)')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true });

  if (error) throw new Error(`list members: ${error.message}`);
  return (data ?? []) as unknown as GroupMemberWithProfile[];
}

/** Leaving is a delete on your own membership row; RLS permits exactly that. */
export async function leaveGroup(
  client: JobDropClient,
  groupId: string,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);

  if (error) throw new Error(`leave group: ${error.message}`);
}

export async function markGroupRead(client: JobDropClient, groupId: string): Promise<void> {
  const { error } = await client.rpc('mark_group_read', { p_group_id: groupId });
  if (error) throw new Error(`mark read: ${error.message}`);
}

export type GroupPreview = {
  id: string;
  name: string;
  avatar_url: string | null;
  member_count: number;
};

/**
 * What an invite link can show before joining. Goes through an RPC because a
 * non-member cannot select the group directly (0012_group_join_rpc.sql).
 */
export async function previewGroupByCode(
  client: JobDropClient,
  code: string,
): Promise<GroupPreview | null> {
  const { data, error } = await client.rpc('preview_group_by_code', { code });
  if (error) throw new Error(`look up invite: ${error.message}`);
  return data?.[0] ?? null;
}

export async function joinGroupByCode(client: JobDropClient, code: string): Promise<string> {
  const { data, error } = await client.rpc('join_group_by_code', { code });
  return must(data, error, 'join group');
}

/** The link that goes into WhatsApp. */
export function inviteUrl(joinCode: string, base = 'https://jobdrop.app'): string {
  return `${base}/j/${joinCode}`;
}
