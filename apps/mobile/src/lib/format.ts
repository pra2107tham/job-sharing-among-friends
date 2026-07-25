/**
 * Time formatting for a feed you scan rather than read.
 *
 * "3m" and "2d" beat "3 minutes ago" when they sit in a tight row of metadata,
 * and beat absolute timestamps for anything under a week.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 45) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;

  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "in 3 groups" / "in Backend crew" — the provenance line on a feed card. */
export function shareProvenance(item: {
  first_sharer_name: string | null;
  first_group_name: string | null;
  group_count: number;
  sharer_count: number;
}): string {
  const who = item.first_sharer_name ?? 'Someone';
  const where =
    item.group_count > 1 ? `${item.group_count} groups` : (item.first_group_name ?? 'a group');

  const others =
    item.sharer_count > 1
      ? ` +${item.sharer_count - 1} other${item.sharer_count > 2 ? 's' : ''}`
      : '';

  return `${who}${others} · ${where}`;
}
