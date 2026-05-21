import Anthropic from '@anthropic-ai/sdk';
import { getPosts, getPages, getPost, getPage, updatePost, updatePage } from '../utils/wp-api.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const TRANSLATE_LANGS = {
  de: 'Deutsch',
  en: 'English',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Português',
  ru: 'Русский',
  ja: '日本語',
  zh: '中文',
  ar: 'العربية',
};

// Tokenise HTML into raw/tag/text tokens so only text nodes are translated.
// Priority order in regex:
//   1. HTML comments  <!-- ... -->
//   2. <script> / <style> blocks (keep raw)
//   3. Any HTML tag  <...>
//   4. Text nodes (everything else)
function tokeniseHtml(html) {
  const tokens = [];
  const re = /<!--[\s\S]*?-->|<(?:script|style)[^>]*>[\s\S]*?<\/(?:script|style)>|<[^>]*>|[^<]+/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const v = m[0];
    if (v.startsWith('<!--') || /^<(?:script|style)/i.test(v)) {
      tokens.push({ type: 'raw', value: v });
    } else if (v.startsWith('<')) {
      tokens.push({ type: 'tag', value: v });
    } else {
      tokens.push({ type: 'text', value: v });
    }
  }
  return tokens;
}

// A text node is translatable if it contains at least two letters (not just whitespace/entities).
function isTranslatable(text) {
  return /[a-zA-ZÀ-ÿĀ-ɏЀ-ӿ぀-ヿ一-鿿]{2,}/.test(text);
}

// Send a batch of plain-text strings to Claude and get back a {index: translation} map.
async function translateBatch(texts, targetLangCode) {
  if (texts.length === 0) return {};
  const langName = TRANSLATE_LANGS[targetLangCode] || targetLangCode;

  const numbered = texts.map((t, i) => `${i}: ${JSON.stringify(t)}`).join('\n');

  const prompt = `Translate the following numbered text segments into ${langName}.

Rules:
- Preserve HTML entities (&amp; &nbsp; &lt; &gt; &quot; etc.) exactly as-is
- Preserve numbers, URLs, e-mail addresses, and brand names exactly
- Keep the same surrounding whitespace (leading/trailing newlines or spaces)
- Return ONLY valid JSON with integer keys: {"0":"translation","1":"translation",...}

Texts:
${numbered}`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: 'You are a professional translator. Respond with valid JSON only. No markdown, no explanation.',
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0]?.text?.trim() || '{}';
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}

// Translate all text nodes in an HTML string; return translated HTML.
async function translateHtml(html, targetLangCode) {
  if (!html) return html;

  const tokens = tokeniseHtml(html);
  const candidates = tokens
    .map((t, i) => ({ i, value: t.value, type: t.type }))
    .filter(({ type, value }) => type === 'text' && isTranslatable(value));

  if (candidates.length === 0) return html;

  // Batch into groups of 80 to stay well within context limits.
  const BATCH = 80;
  const translations = {};
  for (let b = 0; b < candidates.length; b += BATCH) {
    const slice = candidates.slice(b, b + BATCH);
    const result = await translateBatch(slice.map((c) => c.value), targetLangCode);
    slice.forEach((c, idx) => {
      const translated = result[String(idx)];
      if (typeof translated === 'string') translations[c.i] = translated;
    });
  }

  return tokens.map((t, i) => (translations[i] !== undefined ? translations[i] : t.value)).join('');
}

// ── Public API ───────────────────────────────────────────────────

export async function listTranslatableItems() {
  const [posts, pages] = await Promise.all([
    getPosts({ _fields: 'id,title,status,link' }).catch(() => []),
    getPages({ _fields: 'id,title,status,link' }).catch(() => []),
  ]);
  return [
    ...pages.map((p) => ({ id: p.id, type: 'page', title: p.title?.rendered || '(no title)', url: p.link })),
    ...posts.map((p) => ({ id: p.id, type: 'post', title: p.title?.rendered || '(no title)', url: p.link })),
  ];
}

export async function translateItem(id, type, targetLangCode) {
  const item = type === 'page'
    ? await getPage(id, { context: 'edit' })
    : await getPost(id, { context: 'edit' });

  const originalTitle = item.title?.rendered || '';
  // Prefer raw block content so Gutenberg block comments are preserved unchanged.
  const originalContent = item.content?.raw || item.content?.rendered || '';
  const originalExcerpt = item.excerpt?.raw || item.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim() || '';

  const [translatedTitle, translatedContent, translatedExcerpt] = await Promise.all([
    translateBatch([originalTitle], targetLangCode).then((r) => r['0'] || originalTitle),
    translateHtml(originalContent, targetLangCode),
    originalExcerpt
      ? translateBatch([originalExcerpt], targetLangCode).then((r) => r['0'] || originalExcerpt)
      : Promise.resolve(''),
  ]);

  const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    id,
    type,
    title: originalTitle,
    translatedTitle,
    contentSnippet: stripTags(originalContent).substring(0, 200),
    translatedContentSnippet: stripTags(translatedContent).substring(0, 200),
    translatedContent,
    translatedExcerpt,
  };
}

export async function applyTranslation(id, type, translatedTitle, translatedContent, translatedExcerpt) {
  const data = {};
  if (translatedTitle) data.title = translatedTitle;
  if (translatedContent) data.content = translatedContent;
  if (translatedExcerpt) data.excerpt = translatedExcerpt;
  if (type === 'page') return updatePage(id, data);
  return updatePost(id, data);
}
