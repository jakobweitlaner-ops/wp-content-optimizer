import Anthropic from '@anthropic-ai/sdk';
import {
  getPosts, getPages, getPost, getPage,
  updatePost, updatePage, createPost, createPage,
} from '../utils/wp-api.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── HTML Tokeniser ───────────────────────────────────────────────
//
// Splits HTML into three token types so the translator ONLY ever touches
// plain text nodes — never tags, attributes, or block markup.
//
//   raw   → HTML comments (incl. Gutenberg <!-- wp:... -->) and <script>/<style>
//   tag   → any HTML element  <img src="…">  </p>  <br/>  etc.
//   text  → everything between tags (the only thing we translate)
//
// Because tags and raw tokens are copied as-is, image src attributes,
// href links, Gutenberg JSON payloads, and all HTML structure are
// guaranteed to be unchanged byte-for-byte.

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

// A text node worth translating must contain at least 2 consecutive alphabetic
// characters and must not be a bare URL, HTML entity string, or WP shortcode.
function isTranslatable(text) {
  const t = text.trim();
  if (!t) return false;
  if (/^(&[a-zA-Z#\d]+;|\s)+$/.test(t)) return false;    // pure entities
  if (/^https?:\/\/\S+$/.test(t) || /^\/\/\S+$/.test(t)) return false; // bare URL
  if (/^\[[^\]\n]{1,80}\]$/.test(t)) return false;         // WP shortcode
  // Must have ≥2 consecutive letters (covers Latin, extended Latin, Cyrillic, CJK, Hangul)
  return /[a-zA-ZÀ-ÿĀ-ɏЀ-ӿ一-鿿぀-ヿ가-힣]{2,}/.test(text);
}

// ── Claude translation batch ─────────────────────────────────────

async function translateBatch(texts, targetLangName) {
  if (texts.length === 0) return {};

  const numbered = texts.map((t, i) => `${i}: ${JSON.stringify(t)}`).join('\n');

  const prompt = `Translate the following numbered text segments into ${targetLangName}.

Strict rules — violations will break the website:
- Return ONLY valid JSON: {"0":"…","1":"…"} — no markdown, no explanation
- Preserve ALL leading/trailing whitespace (spaces, tabs, newlines) exactly
- Preserve HTML entities (&amp; &nbsp; &lt; &gt; &quot; &#…;) byte-for-byte
- Preserve every URL (http://, https://, /path/to/page) exactly — never translate or shorten them
- Preserve every image filename (*.jpg, *.png, *.webp, *.svg, *.gif, *.pdf, *.mp4) exactly
- Preserve email addresses exactly
- Preserve WordPress shortcodes ([contact-form-7 …]) exactly
- Preserve phone numbers, postal codes, and numeric codes exactly
- Keep proper nouns and brand names appropriate for the target language

Texts to translate:
${numbered}`;

  const msg = await client.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: 'You are a professional translator. Output valid JSON only. Never add explanation, comments, or markdown formatting.',
      messages: [{ role: 'user', content: prompt }],
    },
    { timeout: 90_000 },
  );

  const raw = msg.content[0]?.text?.trim() || '{}';
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}

// Translate all translatable text nodes in an HTML string.
// Tags, attributes, HTML comments, and script/style blocks are never touched.
// onProgress(batchIndex, totalBatches) is called before each Claude API call.
async function translateHtml(html, targetLangName, onProgress) {
  if (!html) return html;

  const tokens = tokeniseHtml(html);
  const candidates = tokens
    .map((t, i) => ({ i, value: t.value, type: t.type }))
    .filter(({ type, value }) => type === 'text' && isTranslatable(value));

  if (candidates.length === 0) return html;

  // 50 segments per batch: conservative limit that keeps the JSON response
  // comfortably within Haiku's 8192-token output ceiling even for long texts.
  const BATCH = 50;
  const totalBatches = Math.ceil(candidates.length / BATCH);
  const translations = {};

  for (let b = 0; b < candidates.length; b += BATCH) {
    const batchIndex = Math.floor(b / BATCH);
    if (onProgress) onProgress(batchIndex, totalBatches);

    const slice = candidates.slice(b, b + BATCH);
    const result = await translateBatch(slice.map((c) => c.value), targetLangName);
    slice.forEach((c, idx) => {
      const tr = result[String(idx)];
      if (typeof tr === 'string') translations[c.i] = tr;
    });
  }

  // Reassemble — only text tokens that got a translation are replaced.
  return tokens.map((t, i) => (translations[i] !== undefined ? translations[i] : t.value)).join('');
}

// ── Public API ───────────────────────────────────────────────────

// Fetch all published posts and pages together with their Polylang metadata.
// Returns: { id, type, title, url, lang, translations }
export async function listTranslatableItems() {
  const fields = 'id,title,status,link,lang,translations';
  const [posts, pages] = await Promise.all([
    getPosts({ _fields: fields }).catch(() => []),
    getPages({ _fields: fields }).catch(() => []),
  ]);
  return [
    ...pages.map((p) => ({
      id: p.id,
      type: 'page',
      title: p.title?.rendered || '(no title)',
      url: p.link,
      lang: p.lang || null,
      translations: p.translations || {},
    })),
    ...posts.map((p) => ({
      id: p.id,
      type: 'post',
      title: p.title?.rendered || '(no title)',
      url: p.link,
      lang: p.lang || null,
      translations: p.translations || {},
    })),
  ];
}

// Translate a single post/page and return all data needed to save it.
// targetLangName: display name used in the Claude prompt (e.g. "English")
// onProgress(message): optional callback emitted before each Claude API call
export async function translateItem(id, type, targetLangCode, targetLangName, onProgress) {
  if (onProgress) onProgress('Lade Seite aus WordPress…');
  const item = type === 'page'
    ? await getPage(id, { context: 'edit' })
    : await getPost(id, { context: 'edit' });

  const sourceLang = item.lang || null;
  const polylangTranslations = item.translations || {};
  const existingTranslationId = polylangTranslations[targetLangCode] || 0;

  const originalTitle = item.title?.rendered || '';
  // Use raw Gutenberg block content so block comments are preserved unchanged.
  const originalContent = item.content?.raw || item.content?.rendered || '';
  const originalExcerpt = item.excerpt?.raw
    || item.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim()
    || '';

  if (onProgress) onProgress('Übersetze Titel…');
  const translatedTitle = await translateBatch([originalTitle], targetLangName)
    .then((r) => r['0'] || originalTitle);

  if (onProgress) onProgress('Übersetze Inhalt…');
  const translatedContent = await translateHtml(originalContent, targetLangName,
    (batchIdx, totalBatches) => {
      if (onProgress && totalBatches > 1) {
        onProgress(`Übersetze Inhalt… Batch ${batchIdx + 1}/${totalBatches}`);
      }
    },
  );

  let translatedExcerpt = '';
  if (originalExcerpt) {
    if (onProgress) onProgress('Übersetze Auszug…');
    translatedExcerpt = await translateBatch([originalExcerpt], targetLangName)
      .then((r) => r['0'] || originalExcerpt);
  }

  const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    id,
    type,
    sourceLang,
    sourceMeta: item.meta || {},
    polylangTranslations,
    existingTranslationId,
    title: originalTitle,
    translatedTitle,
    contentSnippet: stripTags(originalContent).substring(0, 220),
    translatedContentSnippet: stripTags(translatedContent).substring(0, 220),
    translatedContent,
    translatedExcerpt,
  };
}

// Save a translation back to WordPress, respecting Polylang structure:
//   existingTranslationId > 0  → update the already-linked translation post
//   existingTranslationId === 0 → create a new draft in targetLangCode and link it
export async function applyTranslation({
  id,
  type,
  targetLangCode,
  existingTranslationId,
  polylangTranslations,
  sourceLang,
  sourceMeta,
  translatedTitle,
  translatedContent,
  translatedExcerpt,
}) {
  const payload = {};
  if (translatedTitle)   payload.title   = translatedTitle;
  if (translatedContent) payload.content = translatedContent;
  if (translatedExcerpt) payload.excerpt = translatedExcerpt;
  // Copy display/layout meta from source (e.g. hide_title, theme page templates).
  if (sourceMeta && typeof sourceMeta === 'object' && Object.keys(sourceMeta).length > 0) {
    payload.meta = sourceMeta;
  }

  if (existingTranslationId > 0) {
    // Translation already exists in Polylang — just update its content.
    if (type === 'page') return updatePage(existingTranslationId, payload);
    return updatePost(existingTranslationId, payload);
  }

  // No linked translation yet — create a new draft and tell Polylang to link it.
  // Derive slug from translated title so the URL matches the target language.
  const slug = translatedTitle
    ? translatedTitle
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 80)
    : undefined;

  const newPayload = {
    ...payload,
    ...(slug ? { slug } : {}),
    status: 'draft',
    lang: targetLangCode,
    // Include all known sibling IDs so Polylang connects the full translation set.
    translations: {
      ...polylangTranslations,
      ...(sourceLang ? { [sourceLang]: id } : {}),
      [targetLangCode]: 0,  // 0 = "this new post"
    },
  };

  if (type === 'page') return createPage(newPayload);
  return createPost(newPayload);
}
