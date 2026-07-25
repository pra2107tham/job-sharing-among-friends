import type { JobPostRow } from '@jobdrop/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { Body, Button, Loading, Screen, Title } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

/**
 * Job detail (doc 1 §5.2).
 *
 * Always shows something: if enrichment has not run or failed outright, the raw
 * input the user shared is the content. A share never degrades to an error.
 */
export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<JobPostRow | null | 'loading'>('loading');

  useEffect(() => {
    void supabase
      .from('job_posts')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => setJob(data));
  }, [id]);

  if (job === 'loading') return <Loading />;

  if (!job) {
    return (
      <>
        <Stack.Screen options={{ title: 'Job', headerShown: true }} />
        <Screen>
          <View className="flex-1 justify-center">
            <Title>Not available</Title>
            <Body className="mt-sm">
              This job was shared in a group you&apos;re no longer part of.
            </Body>
          </View>
        </Screen>
      </>
    );
  }

  const applyUrl = job.apply_url ?? job.canonical_url;
  const description = job.description ?? job.raw_input;

  return (
    <>
      <Stack.Screen options={{ title: job.company ?? 'Job', headerShown: true }} />
      <Screen>
        <ScrollView contentContainerClassName="py-lg gap-lg" showsVerticalScrollIndicator={false}>
          <View className="gap-xs">
            <Title>{job.title ?? 'Shared job'}</Title>
            {job.company ? <Body className="text-base">{job.company}</Body> : null}
            <Text className="text-xs text-ink300">
              {[job.location, job.work_mode, job.salary_text].filter(Boolean).join(' · ')}
            </Text>
            <Text className="text-xs text-ink300">shared {relativeTime(job.created_at)}</Text>
          </View>

          {job.parse_status === 'pending' ? (
            <View className="rounded-md bg-ink50 px-md py-sm dark:bg-ink700">
              <Text className="text-xs text-ink500 dark:text-ink300">
                Still reading this posting — details will fill in shortly.
              </Text>
            </View>
          ) : null}

          {job.apply_emails.length > 0 ? (
            <View className="gap-xs">
              <Text className="text-xs uppercase text-ink300">Apply by email</Text>
              {job.apply_emails.map((email) => (
                <Text key={email} selectable className="text-base text-ink900 dark:text-ink50">
                  {email}
                </Text>
              ))}
            </View>
          ) : null}

          {description ? (
            <View className="gap-xs">
              <Text className="text-xs uppercase text-ink300">Description</Text>
              <Text className="text-sm leading-6 text-ink900 dark:text-ink50" selectable>
                {description}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View className="gap-md pb-xl">
          {applyUrl ? (
            <Button label="Open posting" onPress={() => void Linking.openURL(applyUrl)} />
          ) : null}
          {job.apply_emails[0] ? (
            <Button
              label="Email your resume"
              variant="secondary"
              onPress={() => {
                const subject = encodeURIComponent(
                  job.title ? `Application — ${job.title}` : 'Job application',
                );
                void Linking.openURL(`mailto:${job.apply_emails[0]}?subject=${subject}`);
              }}
            />
          ) : null}
        </View>
      </Screen>
    </>
  );
}
