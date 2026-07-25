import { extractEmails, registrableDomain } from '@jobdrop/contracts';

/**
 * Turning a fetched page into job fields.
 *
 * Deliberately dependency-free and pure, so it can be tested against saved
 * fixtures without a network. The order matters:
 *
 *   1. schema.org/JobPosting JSON-LD — most real job boards emit it, and it is
 *      structured data rather than a guess. Doc 1 §6.1 calls this out as free
 *      accuracy and it is worth the extra code.
 *   2. Open Graph / meta tags — a decent title and image for everything else.
 *   3. Nothing. A card with just a hostname is a valid outcome; a share must
 *      never fail because a page was unparseable (doc 1 §5.1).
 */

export type ParsedJob = {
  title?: string;
  company?: string;
  location?: string;
  workMode?: 'onsite' | 'hybrid' | 'remote';
  employmentType?: string;
  salaryText?: string;
  description?: string;
  applyUrl?: string;
  applyEmails?: string[];
  ogImageUrl?: string;
  faviconUrl?: string;
  sourceSite?: string;
  postedAt?: string;
  closesAt?: string;
  /** 'ok' when we got a title AND a company; 'partial' when we got something. */
  status: 'ok' | 'partial' | 'failed';
};

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

/** Strip tags and collapse whitespace — JD bodies arrive as HTML fragments. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|li|br|h[1-6]|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function metaContent(html: string, patterns: string[]): string | undefined {
  for (const name of patterns) {
    const re = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    if (!tag) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content?.trim()) return decodeEntities(content.trim());
  }
  return undefined;
}

type JsonLdNode = Record<string, unknown>;

/** All JSON-LD blocks, flattened through @graph. Bad JSON is skipped silently. */
export function extractJsonLd(html: string): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(re)) {
    const body = match[1];
    if (!body) continue;
    try {
      const parsed: unknown = JSON.parse(body.trim());
      const queue = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of queue) {
        if (!entry || typeof entry !== 'object') continue;
        const node = entry as JsonLdNode;
        nodes.push(node);
        const graph = node['@graph'];
        if (Array.isArray(graph)) {
          for (const g of graph) {
            if (g && typeof g === 'object') nodes.push(g as JsonLdNode);
          }
        }
      }
    } catch {
      // Malformed JSON-LD is extremely common; fall through to OG tags.
    }
  }
  return nodes;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function findJobPosting(nodes: JsonLdNode[]): JsonLdNode | undefined {
  return nodes.find((n) => {
    const type = n['@type'];
    if (typeof type === 'string') return type === 'JobPosting';
    if (Array.isArray(type)) return type.includes('JobPosting');
    return false;
  });
}

function locationFromJsonLd(node: JsonLdNode): string | undefined {
  const raw = node['jobLocation'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first || typeof first !== 'object') return undefined;

  const address = (first as JsonLdNode)['address'];
  if (!address || typeof address !== 'object') return undefined;

  const a = address as JsonLdNode;
  const parts = [asString(a['addressLocality']), asString(a['addressRegion'])].filter(Boolean);
  return parts.length ? parts.join(', ') : asString(a['addressCountry']);
}

function salaryFromJsonLd(node: JsonLdNode): string | undefined {
  const salary = node['baseSalary'];
  if (!salary || typeof salary !== 'object') return undefined;

  const value = (salary as JsonLdNode)['value'];
  const currency = asString((salary as JsonLdNode)['currency']) ?? '';
  if (!value || typeof value !== 'object') return undefined;

  const v = value as JsonLdNode;
  const min = v['minValue'];
  const max = v['maxValue'];
  const unit = asString(v['unitText'])?.toLowerCase();

  if (typeof min === 'number' && typeof max === 'number') {
    return `${currency} ${min}-${max}${unit ? ` per ${unit}` : ''}`.trim();
  }
  const single = v['value'];
  if (typeof single === 'number') {
    return `${currency} ${single}${unit ? ` per ${unit}` : ''}`.trim();
  }
  return undefined;
}

/** "Zeta Careers" -> "Zeta". Leaves a name alone if trimming would empty it. */
function cleanCompany(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const trimmed = name
    .replace(/\s*[-–|]\s*(careers?|jobs?|hiring|job board|work with us)\s*$/i, '')
    .replace(/\s+(careers?|jobs?|hiring|job board)\s*$/i, '')
    .trim();
  return trimmed || name.trim();
}

/** Remote-ness is stated many ways; only claim it when the page is explicit. */
function workModeFrom(text: string): ParsedJob['workMode'] | undefined {
  const t = text.toLowerCase();
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\b(fully[- ])?remote\b|work from home|telecommute/.test(t)) return 'remote';
  if (/\bon[- ]?site\b|\bin[- ]office\b/.test(t)) return 'onsite';
  return undefined;
}

export function parseJobFromHtml(html: string, url: string): ParsedJob {
  const result: ParsedJob = { status: 'failed' };

  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
    result.sourceSite = registrableDomain(host);
    result.faviconUrl = `https://${host}/favicon.ico`;
  } catch {
    // A malformed URL should not stop us parsing the body we were given.
  }

  const posting = findJobPosting(extractJsonLd(html));

  if (posting) {
    result.title = asString(posting['title']);

    const org = posting['hiringOrganization'];
    if (org && typeof org === 'object') {
      result.company = asString((org as JsonLdNode)['name']);
    } else {
      result.company = asString(org);
    }

    result.location = locationFromJsonLd(posting);
    result.employmentType = asString(posting['employmentType']);
    result.salaryText = salaryFromJsonLd(posting);
    result.postedAt = asString(posting['datePosted']);
    result.closesAt = asString(posting['validThrough']);
    result.applyUrl = asString(posting['url']);

    const description = asString(posting['description']);
    if (description) result.description = htmlToText(description);

    const remote = posting['jobLocationType'];
    if (typeof remote === 'string' && /telecommute/i.test(remote)) result.workMode = 'remote';
  }

  // Fill gaps from OG/meta regardless of whether JSON-LD was present.
  result.title ??= metaContent(html, ['og:title', 'twitter:title']);
  result.ogImageUrl ??= metaContent(html, ['og:image', 'twitter:image']);
  // og:site_name is usually the careers portal, not the employer: "Zeta Careers",
  // "Acme Job Board". Trimming that suffix is the difference between a card that
  // reads like a job and one that reads like a scrape.
  result.company ??= cleanCompany(metaContent(html, ['og:site_name']));
  result.description ??= (() => {
    const desc = metaContent(html, ['og:description', 'description', 'twitter:description']);
    return desc ? htmlToText(desc) : undefined;
  })();

  if (result.title) {
    // "Backend Engineer at Acme" / "Backend Engineer - Acme" — boards love this
    // and it is often the only place the company name appears.
    const split = result.title.match(/^(.*?)\s+(?:at|@|[-–|])\s+(.+)$/);
    if (split?.[1] && split[2]) {
      result.title = split[1].trim();
      result.company ??= split[2].trim();
    }
  }

  const haystack = [result.title, result.description, result.location].filter(Boolean).join(' ');
  result.workMode ??= workModeFrom(haystack);

  if (result.description) {
    const emails = extractEmails(result.description);
    if (emails.length) result.applyEmails = emails;
  }

  if (result.title && result.company) result.status = 'ok';
  else if (result.title || result.description) result.status = 'partial';

  return result;
}

/** A login wall is not a parse failure worth retrying forever. */
export function looksAuthWalled(html: string, url: string): boolean {
  let host = '';
  try {
    host = registrableDomain(new URL(url).hostname);
  } catch {
    return false;
  }
  if (host !== 'linkedin.com') return false;

  return /authwall|<title>[^<]*sign\s?up[^<]*<\/title>|please log in/i.test(html.slice(0, 40000));
}
