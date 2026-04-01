/**
 * scriptGen.js — Claude-powered script generation for DemoReel
 * Replaced Gemini → Claude (claude-haiku-4-5) for speed + cost
 */

const https = require('https');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Fetch page content via simple HTTP GET (text only)
 */
async function fetchPageText(url) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : require('http');
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DemoReel/3.0)',
          'Accept': 'text/html',
        },
        timeout: 10000,
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          const text = data
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 3000);
          resolve(text);
        });
      });

      req.on('error', () => resolve(''));
      req.on('timeout', () => { req.destroy(); resolve(''); });
      req.end();
    } catch {
      resolve('');
    }
  });
}

/**
 * Generate a narration script for a given URL or description
 */
async function generateScript({ url, purpose = 'product-demo', duration = 30, tone = 'professional', description = '' }) {
  // Fetch page text if URL is provided
  let pageText = '';
  if (url) {
    pageText = await fetchPageText(url);
  }

  const purposeLabels = {
    'product-demo': 'product demonstration',
    'tutorial': 'tutorial walkthrough',
    'showcase': 'feature showcase',
    'teaser': 'teaser/preview',
  };

  const toneLabels = {
    professional: 'professional and polished',
    casual: 'casual and friendly',
    exciting: 'energetic and exciting',
    technical: 'detailed and technical',
  };

  const contextParts = [];
  if (description) contextParts.push(`Feature description: ${description}`);
  if (url) contextParts.push(`URL: ${url}`);
  if (pageText) contextParts.push(`Page content (excerpt): ${pageText}`);

  const context = contextParts.join('\n\n') || 'No additional context provided.';

  const prompt = `You are a professional product demo script writer.

${context}

Write a ${toneLabels[tone] || 'professional'} voiceover script for a ${purposeLabels[purpose] || 'product demo'} video that is approximately ${duration} seconds long.

Requirements:
- Natural speaking pace (~150 words/min, so ~${Math.round(duration * 150 / 60)} words)
- Write it as continuous narration, no stage directions
- Focus on benefits and value, not just features
- Sound natural when spoken aloud

Then provide a JSON breakdown of sections tied to scroll position percentages.

Format your response EXACTLY as:
SCRIPT:
[the narration text here]

SECTIONS:
[{"text": "first sentence or two", "scrollPercent": 0}, {"text": "next section", "scrollPercent": 30}, ...]`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawResponse = message.content[0].text;

  // Parse response
  let script = '';
  let sections = [];

  const scriptMatch = rawResponse.match(/SCRIPT:\s*([\s\S]*?)(?:\n\nSECTIONS:|$)/i);
  if (scriptMatch) {
    script = scriptMatch[1].trim();
  } else {
    script = rawResponse.trim();
  }

  const sectionsMatch = rawResponse.match(/SECTIONS:\s*(\[[\s\S]*?\])/i);
  if (sectionsMatch) {
    try {
      sections = JSON.parse(sectionsMatch[1]);
    } catch {
      sections = [];
    }
  }

  // Generate default sections if parsing failed
  if (!sections.length && script) {
    const sentences = script.split(/(?<=[.!?])\s+/);
    const total = sentences.length;
    sections = sentences.map((text, i) => ({
      text,
      scrollPercent: Math.round((i / total) * 100),
    }));
  }

  return { script, sections };
}

module.exports = { generateScript };
