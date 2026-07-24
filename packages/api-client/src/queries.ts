import type { GroupRow, ProfileRow, ProfileUpdate } from '@jobdrop/contracts';
import type { JobDropClient } from './client';

/**
 * Query helpers.
 *
 * Thin on purpose: they exist so that RLS-shaped mistakes (forgetting that a
 * denied read returns an empty list rather than an error) live in one place
 * instead of every screen.
 */

/** Turn a PostgREST error into something throwable, preserving the code. */
function must<T>(
  data: T | null,
  error: { message: string; code?: string } | null,
  what: string,
): T {
  if (error) {
    const err = new Error(`${what}: ${error.message}`) as Error & { code?: string };
    if (error.code !== undefined) err.code = error.code;
    throw err;
  }
  if (data === null) throw new Error(`${what}: no data returned`);
  return data;
}

export async function getMyProfile(client: JobDropClient): Promise<ProfileRow | null> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (error) throw new Error(`load profile: ${error.message}`);
  return data;
}

/** Onboarding is complete once a handle has been chosen (0002_profiles.sql). */
export function isOnboarded(profile: ProfileRow | null): boolean {
  return profile !== null && profile.handle !== null && profile.onboarded_at !== null;
}

export async function completeOnboarding(
  client: JobDropClient,
  userId: string,
  update: ProfileUpdate,
): Promise<ProfileRow> {
  const { data, error } = await client
    .from('profiles')
    .update({
      handle: update.handle,
      display_name: update.display_name,
      onboarded_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  return must(data, error, 'save profile');
}

/** Returns only groups the caller belongs to — RLS does the filtering. */
export async function listMyGroups(client: JobDropClient): Promise<GroupRow[]> {
  const { data, error } = await client
    .from('groups')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`list groups: ${error.message}`);
  return data ?? [];
}

export async function createGroup(
  client: JobDropClient,
  name: string,
  createdBy: string,
): Promise<GroupRow> {
  // .select() here relies on groups_select_member allowing the creator to read
  // the row back before the membership trigger has run. See 0010_rls_policies.sql.
  const { data, error } = await client
    .from('groups')
    .insert({ name, created_by: createdBy })
    .select()
    .single();

  return must(data, error, 'create group');
}

export async function previewGroupByCode(client: JobDropClient, code: string) {
  const { data, error } = await client.rpc('preview_group_by_code', { code });
  if (error) throw new Error(`look up invite: ${error.message}`);
  return data?.[0] ?? null;
}

export async function joinGroupByCode(client: JobDropClient, code: string): Promise<string> {
  const { data, error } = await client.rpc('join_group_by_code', { code });
  return must(data, error, 'join group');
}
