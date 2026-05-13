import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to your .env file.');
  }
  if (!_client) _client = new Anthropic();
  return _client;
}

export async function generateSeoFixes(post, issues) {
  const needsTitle = issues.some((i) => /title/i.test(i));
  const needsExcerpt = issues.some((i) => /excerpt/i.test(i));
  if (!needsTitle && !needsExcerpt) return null;

  const title = post.title?.rendered || '';
  const text = stripHtml(post.content?.rendered || '').substring(0, 1500);

  const wanted = [];
  if (needsTitle) wanted.push('"title": string, 20–60 chars');
  if (needsExcerpt) wanted.push('"excerpt": string, 120–155 chars');

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 300,
    system: [
      {
        type: 'text',
        text: 'You are a WordPress SEO expert. Return ONLY a valid JSON object with the requested fields. No markdown, no explanation.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Current title: "${title}"\nPost content: ${text}\nSEO issues: ${issues.join('; ')}\n\nProvide JSON: { ${wanted.join(', ')} }`,
      },
    ],
  });

  try {
    const match = response.content[0].text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

export async function generateAltText(imageUrl) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 100,
    system: [
      {
        type: 'text',
        text: 'Generate concise, descriptive alt text for web images. Return only the alt text — no quotes, no explanation. Maximum 125 characters.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: 'Alt text:' },
        ],
      },
    ],
  });

  return response.content[0]?.text?.trim().slice(0, 125) || '';
}
