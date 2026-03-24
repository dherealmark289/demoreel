/**
 * voiceover.js — ElevenLabs TTS integration for DemoReel
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

// Preset voice IDs (ElevenLabs)
const VOICE_PRESETS = {
  alloy:   '21m00Tcm4TlvDq8ikWAM',  // Rachel — calm, professional
  echo:    'AZnzlk1XvdvUeBnXmlld',  // Domi — energetic
  fable:   'EXAVITQu4vr4xnSDxMaL',  // Bella — warm, friendly
  onyx:    'VR6AewLTigWG4xSOukaG',  // Arnold — deep, authoritative
  nova:    'pNInz6obpgDQGcFmaJgB',  // Adam — neutral male
  shimmer: 'yoZ06aMxZJJ28mfd3POQ',  // Sam — casual
};

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

/**
 * Generate voiceover audio via ElevenLabs
 * Returns path to saved audio file
 */
async function generateVoiceover({ script, voice = 'alloy', provider = 'elevenlabs' }) {
  if (!script || !script.trim()) {
    throw new Error('Script text is required');
  }

  if (provider === 'elevenlabs' || !provider) {
    return generateElevenLabsVoiceover({ script, voice });
  }

  throw new Error(`Provider "${provider}" not supported. Use "elevenlabs".`);
}

async function generateElevenLabsVoiceover({ script, voice }) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY environment variable not set');
  }

  // Resolve voice ID
  const voiceId = VOICE_PRESETS[voice] || voice || DEFAULT_VOICE_ID;

  const body = JSON.stringify({
    text: script,
    model_id: 'eleven_multilingual_v2',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    },
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'audio/mpeg',
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errData = '';
        res.on('data', chunk => { errData += chunk; });
        res.on('end', () => {
          reject(new Error(`ElevenLabs API error ${res.statusCode}: ${errData.slice(0, 200)}`));
        });
        return;
      }

      // Save to temp file
      const audioId = uuidv4();
      const audioDir = path.join(__dirname, 'public', 'audio');
      fs.mkdirSync(audioDir, { recursive: true });
      const audioPath = path.join(audioDir, `${audioId}.mp3`);
      const writeStream = fs.createWriteStream(audioPath);

      res.pipe(writeStream);

      writeStream.on('finish', () => {
        // Estimate duration (rough: ~150 words/min = 2.5 words/sec)
        const wordCount = script.trim().split(/\s+/).length;
        const estimatedDuration = wordCount / 2.5;
        resolve({
          audioId,
          audioUrl: `/api/audio/${audioId}.mp3`,
          audioPath,
          duration: Math.round(estimatedDuration * 10) / 10,
        });
      });

      writeStream.on('error', reject);
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Get list of available voices
 */
function getVoiceList() {
  return [
    { id: 'alloy',   name: 'Rachel',  gender: 'female', style: 'calm, professional',   voiceId: VOICE_PRESETS.alloy },
    { id: 'echo',    name: 'Domi',    gender: 'female', style: 'energetic, clear',      voiceId: VOICE_PRESETS.echo },
    { id: 'fable',   name: 'Bella',   gender: 'female', style: 'warm, friendly',        voiceId: VOICE_PRESETS.fable },
    { id: 'onyx',    name: 'Arnold',  gender: 'male',   style: 'deep, authoritative',   voiceId: VOICE_PRESETS.onyx },
    { id: 'nova',    name: 'Adam',    gender: 'male',   style: 'neutral, professional', voiceId: VOICE_PRESETS.nova },
    { id: 'shimmer', name: 'Sam',     gender: 'male',   style: 'casual, friendly',      voiceId: VOICE_PRESETS.shimmer },
  ];
}

/**
 * Clean up old audio files (>2 hours)
 */
function cleanupOldAudio() {
  const audioDir = path.join(__dirname, 'public', 'audio');
  if (!fs.existsSync(audioDir)) return;
  const now = Date.now();
  fs.readdirSync(audioDir).forEach(file => {
    const filePath = path.join(audioDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 2 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  });
}

module.exports = { generateVoiceover, getVoiceList, cleanupOldAudio };
