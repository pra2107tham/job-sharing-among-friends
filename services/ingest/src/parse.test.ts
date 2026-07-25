import { describe, expect, it } from 'vitest';
import { extractJsonLd, htmlToText, looksAuthWalled, parseJobFromHtml } from './parse.ts';

const GREENHOUSE = `<!doctype html>
<html><head>
<title>Backend Engineer at Acme</title>
<meta property="og:title" content="Backend Engineer at Acme" />
<meta property="og:image" content="https://cdn.acme.test/card.png" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Backend Engineer",
  "datePosted": "2026-07-01",
  "validThrough": "2026-09-01",
  "employmentType": "FULL_TIME",
  "hiringOrganization": { "@type": "Organization", "name": "Acme" },
  "jobLocation": {
    "@type": "Place",
    "address": { "addressLocality": "Bengaluru", "addressRegion": "KA", "addressCountry": "IN" }
  },
  "baseSalary": {
    "@type": "MonetaryAmount",
    "currency": "INR",
    "value": { "@type": "QuantitativeValue", "minValue": 2000000, "maxValue": 3500000, "unitText": "YEAR" }
  },
  "description": "<p>We need a <b>Go</b> engineer.</p><p>Hybrid role. Write to careers@acme.test</p>"
}
</script>
</head><body></body></html>`;

const OG_ONLY = `<html><head>
<meta property="og:title" content="Senior Data Scientist - Zeta" />
<meta property="og:site_name" content="Zeta Careers" />
<meta property="og:description" content="Fully remote position. Apply at hiring@zeta.test" />
</head><body></body></html>`;

const BARE = `<html><head><title>Careers</title></head><body><p>Nothing here</p></body></html>`;

describe('parseJobFromHtml — JSON-LD path', () => {
  const parsed = parseJobFromHtml(GREENHOUSE, 'https://boards.greenhouse.io/acme/jobs/9');

  it('prefers structured data over the page title', () => {
    expect(parsed.title).toBe('Backend Engineer');
    expect(parsed.company).toBe('Acme');
    expect(parsed.status).toBe('ok');
  });

  it('reads location, salary, dates and employment type', () => {
    expect(parsed.location).toBe('Bengaluru, KA');
    expect(parsed.salaryText).toBe('INR 2000000-3500000 per year');
    expect(parsed.employmentType).toBe('FULL_TIME');
    expect(parsed.postedAt).toBe('2026-07-01');
    expect(parsed.closesAt).toBe('2026-09-01');
  });

  it('converts the HTML description to readable text', () => {
    expect(parsed.description).toContain('We need a Go engineer.');
    expect(parsed.description).not.toContain('<b>');
  });

  it('extracts the HR email — the Phase 2 agent entry point', () => {
    expect(parsed.applyEmails).toEqual(['careers@acme.test']);
  });

  it('infers work mode from the description', () => {
    expect(parsed.workMode).toBe('hybrid');
  });

  it('records the source site and favicon', () => {
    expect(parsed.sourceSite).toBe('greenhouse.io');
    expect(parsed.faviconUrl).toBe('https://boards.greenhouse.io/favicon.ico');
  });
});

describe('parseJobFromHtml — Open Graph fallback', () => {
  const parsed = parseJobFromHtml(OG_ONLY, 'https://zeta.test/careers/42');

  it('splits "Role - Company" titles', () => {
    expect(parsed.title).toBe('Senior Data Scientist');
    expect(parsed.company).toBe('Zeta');
  });

  it('still finds remote and the email', () => {
    expect(parsed.workMode).toBe('remote');
    expect(parsed.applyEmails).toEqual(['hiring@zeta.test']);
  });

  it('is ok once it has a title and a company', () => {
    expect(parsed.status).toBe('ok');
  });
});

describe('parseJobFromHtml — degradation', () => {
  it('never throws and reports failure honestly on an empty page', () => {
    const parsed = parseJobFromHtml(BARE, 'https://example.test/careers');
    expect(parsed.status).toBe('failed');
    expect(parsed.title).toBeUndefined();
  });

  it('survives malformed JSON-LD by falling back to meta tags', () => {
    const broken = `<html><head>
      <script type="application/ld+json">{ this is not json }</script>
      <meta property="og:title" content="Platform Engineer" />
    </head></html>`;
    const parsed = parseJobFromHtml(broken, 'https://example.test/j/1');
    expect(parsed.title).toBe('Platform Engineer');
    expect(parsed.status).toBe('partial');
  });

  it('handles a completely empty string', () => {
    expect(() => parseJobFromHtml('', 'https://example.test')).not.toThrow();
  });

  it('handles a malformed URL', () => {
    expect(() => parseJobFromHtml(GREENHOUSE, 'not a url')).not.toThrow();
  });
});

describe('extractJsonLd', () => {
  it('flattens @graph nodes', () => {
    const html = `<script type="application/ld+json">
      {"@graph":[{"@type":"WebSite"},{"@type":"JobPosting","title":"QA Engineer"}]}
    </script>`;
    const nodes = extractJsonLd(html);
    expect(nodes.some((n: Record<string, unknown>) => n['@type'] === 'JobPosting')).toBe(true);
  });
});

describe('htmlToText', () => {
  it('drops scripts and styles rather than inlining their contents', () => {
    const text = htmlToText('<div>Keep<script>var x = 1;</script><style>a{}</style>this</div>');
    expect(text).not.toContain('var x');
    expect(text).not.toContain('a{}');
    expect(text).toContain('Keep');
  });

  it('turns block tags into line breaks', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\nTwo');
  });

  it('decodes entities', () => {
    expect(htmlToText('<p>R&amp;D &quot;team&quot;</p>')).toBe('R&D "team"');
  });
});

describe('looksAuthWalled', () => {
  it('detects a LinkedIn wall — doc 1 §8 says to expect these', () => {
    expect(
      looksAuthWalled(
        '<html><body>authwall please sign in</body></html>',
        'https://linkedin.com/jobs/view/1',
      ),
    ).toBe(true);
  });

  it('does not flag ordinary boards', () => {
    expect(looksAuthWalled(GREENHOUSE, 'https://boards.greenhouse.io/acme/jobs/9')).toBe(false);
  });
});
