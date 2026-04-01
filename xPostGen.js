/**
 * xPostGen.js — Claude-powered X (Twitter) post generator for DemoReel
 */

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate an X (Twitter) post from a demo video script
 * @param {object} opts
 * @param {string} opts.script - narration script text
 * @param {string} opts.title - product/feature title
 * @param {string} opts.url - product URL
 * @param {string} opts.tone - casual|professional|exciting|technical
 * @returns {{ hook, thread, hashtags, fullPost }}
 */
async function generateXPost({ script, title = '', url = '', tone = 'professional' }) {
  if (!script) throw new Error('Script is required for X post generation');

  const toneGuide = {
    professional: 'professional and concise, like a SaaS founder showing off a new feature',
    casual: 'casual and conversational, like a developer sharing something cool they built',
    exciting: 'energetic and hype-driven, using punchy language to generate excitement',
    technical: 'technical and detailed, written for a developer audience',
  };

  const prompt = `You are a social media expert who writes viral X (Twitter) posts for tech products.

Product title: ${title || 'New Feature'}
Product URL: ${url || ''}
Video script:
${script}

Write an X post that showcases this product/feature. Tone: ${toneGuide[tone] || toneGuide.professional}

Return EXACTLY this format (JSON only, no markdown, no extra text):
{
  "hook": "First tweet (max 280 chars) — punchy, attention-grabbing opening that makes people stop scrolling",
  "thread": [
    "Tweet 2 — elaborate on the key benefit",
    "Tweet 3 — show how it works or a specific use case",
    "Tweet 4 — call to action or closing thought"
  ],
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]
}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = message.content[0].text.trim();

  let parsed;
  try {
    // Try to extract JSON if wrapped in any extra text
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
  } catch (e) {
    throw new Error(`Failed to parse X post response: ${e.message}`);
  }

  const hook = parsed.hook || '';
  const thread = parsed.thread || [];
  const hashtags = parsed.hashtags || [];

  // Build fullPost: hook + hashtags (ready to copy-paste)
  const hashtagStr = hashtags.join(' ');
  const hookWithTags = `${hook}\n\n${hashtagStr}`.trim();

  return {
    hook,
    thread,
    hashtags,
    fullPost: hookWithTags,
  };
}

module.exports = { generateXPost };
