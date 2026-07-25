import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, extractEmails, extractFirstUrl, registrableDomain } from './url';

describe('canonicalizeUrl', () => {
  it('strips tracking parameters but keeps real ones', () => {
    expect(
      canonicalizeUrl('https://jobs.example.com/apply?id=42&utm_source=whatsapp&gclid=x'),
    ).toBe('https://jobs.example.com/apply?id=42');
  });

  it('orders parameters so equivalent URLs hash identically', () => {
    const a = canonicalizeUrl('https://jobs.example.com/x?b=2&a=1');
    const b = canonicalizeUrl('https://jobs.example.com/x?a=1&b=2');
    expect(a).toBe(b);
  });

  it('normalises scheme, www, trailing slash, fragment and port', () => {
    expect(canonicalizeUrl('http://www.jobs.example.com/apply/#section')).toBe(
      'https://jobs.example.com/apply',
    );
  });

  it('accepts a bare domain pasted without a scheme', () => {
    expect(canonicalizeUrl('boards.greenhouse.io/acme/jobs/123')).toBe(
      'https://boards.greenhouse.io/acme/jobs/123',
    );
  });

  it('keeps the root path intact', () => {
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  describe('LinkedIn — the format that arrives five different ways', () => {
    it('collapses a tracked job view to the bare id', () => {
      expect(
        canonicalizeUrl(
          'https://www.linkedin.com/jobs/view/3912345678/?refId=abc&trackingId=xyz&position=3',
        ),
      ).toBe('https://linkedin.com/jobs/view/3912345678');
    });

    it('collapses a slugged job view to the same URL', () => {
      expect(
        canonicalizeUrl('https://www.linkedin.com/jobs/view/backend-engineer-at-acme-3912345678'),
      ).toBe('https://linkedin.com/jobs/view/3912345678');
    });

    it('rewrites a collections link to the job it points at', () => {
      expect(
        canonicalizeUrl(
          'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3912345678&discover=true',
        ),
      ).toBe('https://linkedin.com/jobs/view/3912345678');
    });

    it('makes all three forms identical — the actual dedupe requirement', () => {
      const forms = [
        'https://www.linkedin.com/jobs/view/3912345678/?refId=abc',
        'https://linkedin.com/jobs/view/backend-engineer-at-acme-3912345678',
        'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3912345678',
      ].map(canonicalizeUrl);

      expect(new Set(forms).size).toBe(1);
    });
  });

  it('keeps only the job key on Indeed, across country domains', () => {
    expect(canonicalizeUrl('https://in.indeed.com/viewjob?jk=abc123&from=serp&vjs=3')).toBe(
      'https://in.indeed.com/viewjob?jk=abc123',
    );
  });

  it('drops the query entirely on path-identified boards', () => {
    expect(canonicalizeUrl('https://boards.greenhouse.io/acme/jobs/4567890?gh_src=abc&t=1')).toBe(
      'https://boards.greenhouse.io/acme/jobs/4567890',
    );
  });

  it('does not merge two genuinely different jobs', () => {
    const a = canonicalizeUrl('https://boards.greenhouse.io/acme/jobs/1');
    const b = canonicalizeUrl('https://boards.greenhouse.io/acme/jobs/2');
    expect(a).not.toBe(b);
  });

  it('keeps unknown query parameters, because a false merge is worse', () => {
    expect(canonicalizeUrl('https://careers.acme.com/job?role=17&loc=blr')).toBe(
      'https://careers.acme.com/job?loc=blr&role=17',
    );
  });

  it('returns null rather than throwing on junk', () => {
    for (const junk of [
      '',
      '   ',
      'not a url',
      'javascript:alert(1)',
      'mailto:a@b.com',
      'http://',
    ]) {
      expect(canonicalizeUrl(junk)).toBeNull();
    }
  });
});

describe('registrableDomain', () => {
  it('handles plain and two-part suffixes', () => {
    expect(registrableDomain('www.linkedin.com')).toBe('linkedin.com');
    expect(registrableDomain('boards.greenhouse.io')).toBe('greenhouse.io');
    expect(registrableDomain('jobs.example.co.in')).toBe('example.co.in');
  });
});

describe('extractFirstUrl', () => {
  it('pulls a link out of a forwarded message', () => {
    expect(
      extractFirstUrl('Guys check this out https://boards.greenhouse.io/acme/jobs/9 looks good'),
    ).toBe('https://boards.greenhouse.io/acme/jobs/9');
  });

  it('does not swallow trailing punctuation or brackets', () => {
    expect(extractFirstUrl('see (https://example.com/job) now')).toBe('https://example.com/job');
  });

  it('returns null when there is no link', () => {
    expect(extractFirstUrl('no links here')).toBeNull();
  });
});

describe('extractEmails', () => {
  it('finds an HR address in a pasted JD', () => {
    expect(extractEmails('Send your CV to Careers@AcmeCorp.com before Friday')).toEqual([
      'careers@acmecorp.com',
    ]);
  });

  it('deduplicates and drops noise addresses', () => {
    expect(
      extractEmails('hr@acme.com, hr@acme.com, noreply@acme.com, someone@example.com'),
    ).toEqual(['hr@acme.com']);
  });

  it('trims punctuation that OCR runs into the address', () => {
    expect(extractEmails('Apply: jobs@acme.in.')).toEqual(['jobs@acme.in']);
  });

  it('returns an empty array when there is nothing', () => {
    expect(extractEmails('no emails in this JD at all')).toEqual([]);
  });
});
