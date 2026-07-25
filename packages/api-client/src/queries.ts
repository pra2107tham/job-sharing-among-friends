import type { ProfileRow, ProfileUpdate } from '@jobdrop/contracts';
import type { JobDropClient } from './client';
import { must } from './util';

/**
 * Profile and session helpers. Group, message and share helpers live in
 * groups.ts, messages.ts and share.ts.
 */

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
