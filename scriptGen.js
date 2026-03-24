/**
 * scriptGen.js — Gemini-powered script generation for DemoReel
 */

const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

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
          'User-Agent': 'Mozilla/5.0 (compatible; DemoReel/2.0)',
          'Accept': 'text/html',
        },
        timeout: 10000,
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          // Strip HTML tags and excess whitespace
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
 * Call Gemini Flash API
 */
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text);
        } catch (e) {
          reject(new Error('Failed to parse Gemini response'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Generate a narration script for a given URL
 */
async function generateScript({ url, purpose = 'product-demo', duration = 30, tone = 'professional' }) {
  const pageText = await fetchPageText(url);

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

  const prompt = `You are a professional video narrator for tech demos.

URL: ${url}
Page content (excerpt): ${pageText || '(could not fetch page content)'}

Create a ${toneLabels[tone] || 'professional'} voiceover script for a ${purposeLabels[purpose] || 'product demo'} video that is approximately ${duration} seconds long.

Requirements:
- Natural speaking pace (~150 words/min, so ~${Math.round(duration * 150 / 60)} words)
- Write it as continuous narration, no stage directions
- Focus on benefits and value, not just features
- Sound natural when spoken aloud

Then provide a JSON breakdown of sections tied to scroll position percentages.

Format your response as:
SCRIPT:
[the narration text here]

SECTIONS:
[{"text": "first sentence or two", "scrollPercent": 0}, {"text": "next section", "scrollPercent": 30}, ...]`;

  const rawResponse = await callGemini(prompt);

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
