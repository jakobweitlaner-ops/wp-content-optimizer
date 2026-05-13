import Anthropic from '@anthropic-ai/sdk';

const STATUS_TOOLS = [
  {
    name: 'get_seo_status',
    description: 'Get SEO audit results for all WordPress posts and pages. Returns score distribution, below-threshold count, average score, and the most common SEO issues.',
    input_schema: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          description: 'Score threshold below which posts are flagged (default: 80)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_link_status',
    description: 'Get broken link check results across all WordPress posts and pages.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_media_status',
    description: 'Get media audit results: missing alt texts, oversized images, generic filenames.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

function buildSeoSummary(seoResults, threshold = 80) {
  if (!seoResults || seoResults.length === 0) return { error: 'No SEO data available' };
  const below = seoResults.filter((r) => r.score < threshold);
  const avg = Math.round(seoResults.reduce((s, r) => s + r.score, 0) / seoResults.length);

  const issueCounts = {};
  for (const r of seoResults) {
    for (const issue of r.issues || []) {
      const key = issue.replace(/\d+/g, 'N').replace(/["']/g, '');
      issueCounts[key] = (issueCounts[key] || 0) + 1;
    }
  }
  const topIssues = Object.entries(issueCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([issue, count]) => ({ issue, affected_pages: count }));

  return {
    total_pages: seoResults.length,
    average_score: avg,
    pages_below_threshold: below.length,
    threshold,
    worst_pages: below.slice(0, 3).map((r) => ({
      title: r.title,
      score: r.score,
      top_issues: (r.issues || []).slice(0, 2),
    })),
    most_common_issues: topIssues,
  };
}

function buildLinkSummary(linkResults) {
  if (!linkResults) return { error: 'No link data available' };
  const { brokenLinks = [], timeoutLinks = [] } = linkResults;
  const totalBroken = brokenLinks.reduce((s, e) => s + e.broken.length, 0);
  return {
    pages_with_broken_links: brokenLinks.length,
    total_broken_links: totalBroken,
    pages_with_timeouts: timeoutLinks.length,
    examples: brokenLinks.slice(0, 3).map((e) => ({
      page: e.post.title || e.post.url,
      broken_urls: e.broken.slice(0, 2).map((b) => b.url),
    })),
  };
}

function buildMediaSummary(mediaResults) {
  if (!mediaResults) return { error: 'No media data available' };
  const missingAlt = mediaResults.filter((r) => r.issues?.some((i) => i.includes('alt'))).length;
  const largeFiles = mediaResults.filter((r) =>
    r.issues?.some((i) => i.toLowerCase().includes('large file'))
  ).length;
  const genericNames = mediaResults.filter((r) =>
    r.issues?.some((i) => i.toLowerCase().includes('generic filename') || i.toLowerCase().includes('filename too short'))
  ).length;
  return {
    total_media_with_issues: mediaResults.length,
    missing_alt_text: missingAlt,
    oversized_files: largeFiles,
    generic_filenames: genericNames,
  };
}

export async function getSiteStatus({ seoResults, linkResults, mediaResults }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const client = new Anthropic({ apiKey });

  const messages = [
    {
      role: 'user',
      content:
        'You are a WordPress site health analyst. Use the available tools to gather data, then provide a concise status report. Include: (1) Overall status as 🟢 Healthy, 🟡 Needs Attention, or 🔴 Critical. (2) Key metrics for SEO, links, and media. (3) Top 3 action items. Be concise.',
    },
  ];

  let response;
  // Agentic loop: let Claude call tools until it produces a final answer
  for (let i = 0; i < 6; i++) {
    response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: STATUS_TOOLS,
      messages,
    });

    if (response.stop_reason === 'end_turn') break;
    if (response.stop_reason !== 'tool_use') break;

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    messages.push({ role: 'assistant', content: response.content });

    const toolResults = toolUseBlocks.map((tool) => {
      let result;
      switch (tool.name) {
        case 'get_seo_status':
          result = buildSeoSummary(seoResults, tool.input.threshold);
          break;
        case 'get_link_status':
          result = buildLinkSummary(linkResults);
          break;
        case 'get_media_status':
          result = buildMediaSummary(mediaResults);
          break;
        default:
          result = { error: `Unknown tool: ${tool.name}` };
      }
      return {
        type: 'tool_result',
        tool_use_id: tool.id,
        content: JSON.stringify(result),
      };
    });

    messages.push({ role: 'user', content: toolResults });
  }

  const textBlock = response?.content?.find((b) => b.type === 'text');
  return textBlock?.text ?? 'No status report generated.';
}
