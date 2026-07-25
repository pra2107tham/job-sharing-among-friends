import { jobDisplayTitle } from '@jobdrop/api-client';
import type { FeedItemRow, JobPostRow } from '@jobdrop/contracts';
import { Ionicons } from '@expo/vector-icons';
import { Linking, Pressable, Text, View } from 'react-native';
import { relativeTime, shareProvenance } from '@/lib/format';

/**
 * The job card.
 *
 * It has to look complete while enrichment is still running (doc 1 §4.3): a
 * freshly shared link renders immediately with the hostname as its title and
 * upgrades in place when the unfurl worker fills in the role and company. That
 * is why every field here is optional and nothing renders a spinner larger
 * than a chip.
 */

type CardJob = Pick<
  FeedItemRow,
  | 'title'
  | 'company'
  | 'location'
  | 'work_mode'
  | 'canonical_url'
  | 'apply_url'
  | 'apply_emails'
  | 'raw_input'
  | 'source_site'
  | 'parse_status'
>;

export function jobFromPost(job: JobPostRow): CardJob {
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    work_mode: job.work_mode,
    canonical_url: job.canonical_url,
    apply_url: job.apply_url,
    apply_emails: job.apply_emails,
    raw_input: job.raw_input,
    source_site: job.source_site,
    parse_status: job.parse_status,
  };
}

function Chip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' }) {
  const look = tone === 'accent' ? 'bg-accent50 dark:bg-accent600' : 'bg-ink50 dark:bg-ink700';
  const text =
    tone === 'accent' ? 'text-accent600 dark:text-accent50' : 'text-ink500 dark:text-ink300';
  return (
    <View className={`rounded-pill px-sm py-xs ${look}`}>
      <Text className={`text-xs font-medium ${text}`}>{label}</Text>
    </View>
  );
}

export function JobCard({
  job,
  meta,
  note,
  timestamp,
  onPress,
  pending,
}: {
  job: CardJob;
  /** Feed cards carry provenance; a card inside its own group chat does not. */
  meta?: Pick<
    FeedItemRow,
    'first_sharer_name' | 'first_group_name' | 'group_count' | 'sharer_count'
  >;
  note?: string | null;
  timestamp?: string | null;
  onPress?: () => void;
  pending?: boolean;
}) {
  const title = jobDisplayTitle(job);
  const url = job.apply_url ?? job.canonical_url;
  const hasEmail = job.apply_emails.length > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      className={`rounded-lg border border-ink100 bg-white p-lg dark:border-ink700 dark:bg-ink700 ${
        pending ? 'opacity-60' : 'active:opacity-90'
      }`}
    >
      <View className="flex-row items-start justify-between gap-md">
        <View className="flex-1">
          <Text className="text-base font-semibold text-ink900 dark:text-ink50" numberOfLines={2}>
            {title}
          </Text>
          {job.company ? (
            <Text className="mt-xs text-sm text-ink500 dark:text-ink300" numberOfLines={1}>
              {job.company}
            </Text>
          ) : null}
        </View>
        {timestamp ? (
          <Text className="text-xs text-ink300">
            {pending ? 'sending' : relativeTime(timestamp)}
          </Text>
        ) : null}
      </View>

      {(job.location || job.work_mode || job.parse_status === 'pending') && (
        <View className="mt-md flex-row flex-wrap gap-xs">
          {job.location ? <Chip label={job.location} /> : null}
          {job.work_mode ? <Chip label={job.work_mode} tone="accent" /> : null}
          {/* Honest about what is still happening, without a blocking spinner. */}
          {job.parse_status === 'pending' && !pending ? <Chip label="reading…" /> : null}
        </View>
      )}

      {note ? (
        <Text className="mt-md text-sm italic text-ink500 dark:text-ink300" numberOfLines={3}>
          “{note}”
        </Text>
      ) : null}

      <View className="mt-md flex-row items-center justify-between">
        {meta ? (
          <Text className="flex-1 text-xs text-ink300" numberOfLines={1}>
            {shareProvenance(meta)}
          </Text>
        ) : (
          <View className="flex-1" />
        )}

        <View className="flex-row items-center gap-md">
          {hasEmail ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Email your resume"
              hitSlop={12}
              onPress={() => {
                const subject = encodeURIComponent(
                  job.title ? `Application — ${job.title}` : 'Job application',
                );
                void Linking.openURL(`mailto:${job.apply_emails[0]}?subject=${subject}`);
              }}
            >
              <Ionicons name="mail-outline" size={18} color="#615B54" />
            </Pressable>
          ) : null}
          {url ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open job posting"
              hitSlop={12}
              onPress={() => void Linking.openURL(url)}
            >
              <Ionicons name="open-outline" size={18} color="#615B54" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
