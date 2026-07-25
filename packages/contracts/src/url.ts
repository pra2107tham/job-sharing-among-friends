/**
 * URL canonicalisation — doc 1 §8.
 *
 * This decides whether dedupe works. The same LinkedIn job arrives with five
 * different URLs depending on whether it came from the app, an email, a
 * WhatsApp forward or a recruiter's tracking link; if they do not collapse to
 * one string, the group sees the same role five times and the feed is useless.
 *
 * Two rules keep it honest:
 *   - Only ever *remove* information that cannot change which job is meant.
 *     When unsure, keep the parameter — a false merge (two jobs shown as one)
 *     is much worse than a missed merge.
 *   - Site rules are keyed on the registrable domain, so `in.indeed.com` and
 *     `indeed.co.uk` behave like `indeed.com`.
 */

/** Analytics and campaign junk. Never identifies a job. */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'gclid',
  'gclsrc',
  'dclid',
  'fbclid',
  'msclkid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'referer',
  'referrer',
  'source',
  'src',
  'trk',
  'trkinfo',
  'originalsubdomain',
  'original_referer',
  'refid',
  'refindex',
  'position',
  'papreferer',
  'eqbranchid',
  'trackingid',
  'lipi',
  'licu',
  'said',
  'spm',
  'share_id',
  'sharedfrom',
  'campaignid',
  'adid',
  'from',
]);

/**
 * Parameters that ARE the job identity on specific sites. Everything else on
 * those hosts is dropped, which is far more effective than blocklisting.
 */
const SITE_KEEP_PARAMS: Record<string, string[]> = {
  'indeed.com': ['jk'],
  'glassdoor.com': ['jobListingId'],
  'ziprecruiter.com': ['lvk'],
  'dice.com': ['jobId'],
};

/** Hosts where the path alone identifies the job — drop the query entirely. */
const PATH_ONLY_HOSTS = new Set([
  'linkedin.com',
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'workable.com',
  'smartrecruiters.com',
  'naukri.com',
  'wellfound.com',
  'angel.co',
  'instahyre.com',
  'cutshort.io',
]);

/** Strip `www.` and a leading country/subdomain we know is cosmetic. */
function normaliseHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * Registrable-ish domain: the last two labels, or three when the last two are a
 * known two-part public suffix. Good enough to key site rules on, and it avoids
 * shipping the full public suffix list.
 */
export function registrableDomain(hostname: string): string {
  const host = normaliseHost(hostname);
  const parts = host.split('.');
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join('.');
  const TWO_PART_SUFFIXES = new Set([
    'co.uk',
    'co.in',
    'com.au',
    'co.jp',
    'com.br',
    'co.nz',
    'com.sg',
    'co.za',
  ]);
  return TWO_PART_SUFFIXES.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/**
 * LinkedIn job URLs carry the id in several shapes:
 *   /jobs/view/3912345678/?refId=...       → /jobs/view/3912345678
 *   /jobs/view/some-slug-3912345678        → /jobs/view/3912345678
 *   /jobs/collections/...?currentJobId=123 → /jobs/view/123
 */
function canonicaliseLinkedIn(url: URL): void {
  const currentJobId = url.searchParams.get('currentJobId');
  if (currentJobId && /^\d+$/.test(currentJobId)) {
    url.pathname = `/jobs/view/${currentJobId}`;
    return;
  }

  const match = url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d+)/);
  if (match) url.pathname = `/jobs/view/${match[1]}`;
}

/** Naukri puts a numeric id at the end of the slug: /job-listings-foo-bar-123456 */
function canonicaliseNaukri(url: URL): void {
  const match = url.pathname.match(/-(\d{6,})(?:\/)?$/);
  if (match) url.pathname = url.pathname.replace(/\/$/, '');
}

/**
 * Reduce a URL to a stable identity string, or return null if it is not a URL
 * we can make sense of. Never throws — a share must not fail because a link was
 * malformed.
 */
export function canonicalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const isHttp = /^https?:\/\//i.test(trimmed);

  // A non-http scheme must be rejected outright, not fed to the bare-domain
  // fallback below: prefixing "https://" onto "mailto:hr@acme.com" parses as
  // host `acme.com` with a username, and silently invents a job URL.
  if (hasScheme && !isHttp) return null;

  let url: URL;
  try {
    // Bare domains pasted without a scheme are common in forwarded messages.
    url = new URL(isHttp ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  // Credentials in a job link are always noise, and keeping them would let two
  // identical jobs hash differently.
  if (url.username || url.password) return null;

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname.includes('.')) return null;

  // Always https: the same job on http and https is the same job.
  url.protocol = 'https:';
  url.hostname = normaliseHost(url.hostname);
  url.hash = '';
  url.port = '';
  url.username = '';
  url.password = '';

  const domain = registrableDomain(url.hostname);

  if (domain === 'linkedin.com') canonicaliseLinkedIn(url);
  if (domain === 'naukri.com') canonicaliseNaukri(url);

  const keep = SITE_KEEP_PARAMS[domain];
  if (keep) {
    const kept = new URLSearchParams();
    for (const key of keep) {
      const value = url.searchParams.get(key);
      if (value) kept.set(key, value);
    }
    url.search = kept.toString();
  } else if (PATH_ONLY_HOSTS.has(domain)) {
    url.search = '';
  } else {
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    // Stable ordering, so ?a=1&b=2 and ?b=2&a=1 hash identically.
    url.searchParams.sort();
  }

  // Drop a trailing slash, but never turn a root URL into a bare host.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
}

/** First http(s) URL in a blob of text — a pasted JD or a WhatsApp forward. */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match ? match[0] : null;
}

/**
 * Email addresses in a JD — the "apply by email" path that a lot of Indian
 * hiring uses, and the seed for the Phase 2 agent's email route (docs/03 §3.1).
 */
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Addresses that are never a person you should apply to. */
const EMAIL_NOISE = /^(no-?reply|do-?not-?reply|postmaster|abuse|support|info|privacy)@/i;
const EMAIL_EXAMPLE_DOMAIN =
  /@(example|test|domain|email|yourcompany|company)\.(com|org|net|test)$/i;

export function extractEmails(text: string): string[] {
  const found = text.match(EMAIL_RE) ?? [];
  const cleaned = found
    .map((e) => e.toLowerCase())
    // OCR frequently runs an address into the following word; trailing
    // punctuation is the common case and safe to trim.
    .map((e) => e.replace(/[.,;:]+$/, ''))
    .filter((e) => !EMAIL_NOISE.test(e))
    .filter((e) => !EMAIL_EXAMPLE_DOMAIN.test(e));

  return [...new Set(cleaned)];
}
