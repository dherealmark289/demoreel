/**
 * musicGen.js — Generate 6 background music tracks using ffmpeg synthesis
 * Run: node musicGen.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const MUSIC_DIR = path.join(__dirname, 'public', 'music');
const DURATION = 30;

const TRACKS = [
  { id: 'upbeat-tech',      name: 'Upbeat Tech',      mood: 'energetic',    description: 'Driving electronic beat with pulsing synths',         build: buildUpbeatTech },
  { id: 'corporate-clean',  name: 'Corporate Clean',  mood: 'professional', description: 'Soft piano-like tones with gentle progression',       build: buildCorporateClean },
  { id: 'cinematic-reveal', name: 'Cinematic Reveal', mood: 'dramatic',     description: 'Orchestral swell building to triumphant release',      build: buildCinematicReveal },
  { id: 'chill-lofi',       name: 'Chill Lo-fi',      mood: 'relaxed',      description: 'Mellow warm lo-fi beat feel',                          build: buildChillLofi },
  { id: 'dramatic-tension', name: 'Dramatic Tension', mood: 'suspense',     description: 'Dark suspenseful with building intensity',             build: buildDramaticTension },
  { id: 'playful-bounce',   name: 'Playful Bounce',   mood: 'fun',          description: 'Bright bouncy and cheerful rhythm',                   build: buildPlayfulBounce },
];

// Each builder returns { inputs, filterComplex }
// inputs: array of lavfi source strings (each → -f lavfi -i "...")
// filterComplex must map [0:a],[1:a],... → [out]

function buildUpbeatTech() {
  const d = DURATION;
  const inputs = [
    `sine=frequency=80:sample_rate=44100:duration=${d}`,
    `sine=frequency=160:sample_rate=44100:duration=${d}`,
    `sine=frequency=240:sample_rate=44100:duration=${d}`,
    `sine=frequency=480:sample_rate=44100:duration=${d}`,
    `sine=frequency=1200:sample_rate=44100:duration=${d}`,
  ];
  const fc = [
    `[0:a]volume=0.5[bass]`,
    `[1:a]volume=0.3[mid]`,
    `[2:a]volume=0.2[c5]`,
    `[3:a]volume=0.15,tremolo=f=4:d=0.5[arp]`,
    `[4:a]volume=0.07,tremolo=f=8:d=0.7[hi]`,
    `[bass][mid][c5][arp][hi]amix=inputs=5:normalize=0,afade=t=in:st=0:d=0.5,afade=t=out:st=${d - 1.5}:d=1.5[out]`,
  ].join(';');
  return { inputs, filterComplex: fc };
}

function buildCorporateClean() {
  const d = DURATION;
  const inputs = [
    `sine=frequency=262:sample_rate=44100:duration=${d}`,
    `sine=frequency=330:sample_rate=44100:duration=${d}`,
    `sine=frequency=392:sample_rate=44100:duration=${d}`,
    `sine=frequency=131:sample_rate=44100:duration=${d}`,
    `sine=frequency=524:sample_rate=44100:duration=${d}`,
  ];
  const fc = [
    `[0:a]volume=0.4,aecho=0.3:0.5:120:0.25[root]`,
    `[1:a]volume=0.25,aecho=0.3:0.5:100:0.2[third]`,
    `[2:a]volume=0.2,aecho=0.3:0.5:110:0.2[fifth]`,
    `[3:a]volume=0.35[bass]`,
    `[4:a]volume=0.12[oct]`,
    `[root][third][fifth][bass][oct]amix=inputs=5:normalize=0,afade=t=in:st=0:d=1,afade=t=out:st=${d - 2}:d=2[out]`,
  ].join(';');
  return { inputs, filterComplex: fc };
}

function buildCinematicReveal() {
  const d = DURATION;
  const inputs = [
    `sine=frequency=65:sample_rate=44100:duration=${d}`,
    `sine=frequency=98:sample_rate=44100:duration=${d}`,
    `sine=frequency=131:sample_rate=44100:duration=${d}`,
    `sine=frequency=196:sample_rate=44100:duration=${d}`,
    `sine=frequency=294:sample_rate=44100:duration=${d}`,
    `sine=frequency=440:sample_rate=44100:duration=${d}`,
  ];
  const fc = [
    `[0:a]volume=0.5,aecho=0.6:0.8:400:0.5[deep]`,
    `[1:a]volume=0.4,aecho=0.5:0.7:300:0.4[low]`,
    `[2:a]volume=0.35,aecho=0.4:0.6:250:0.35[cello]`,
    `[3:a]volume=0.25,aecho=0.3:0.5:200:0.3[viola]`,
    `[4:a]volume=0.2,aecho=0.25:0.4:150:0.25[violin]`,
    `[5:a]volume=0.3,aecho=0.5:0.6:180:0.3[brass]`,
    `[deep][low][cello][viola][violin][brass]amix=inputs=6:normalize=0,afade=t=in:st=0:d=3,afade=t=out:st=${d - 2}:d=2[out]`,
  ].join(';');
  return { inputs, filterComplex: fc };
}

function buildChillLofi() {
  const d = DURATION;
  const inputs = [
    `sine=frequency=98:sample_rate=44100:duration=${d}`,
    `sine=frequency=196:sample_rate=44100:duration=${d}`,
    `sine=frequency=293:sample_rate=44100:duration=${d}`,
    `sine=frequency=440:sample_rate=44100:duration=${d}`,
    `sine=frequency=587:sample_rate=44100:duration=${d}`,
  ];
  const fc = [
    `[0:a]volume=0.45,aecho=0.5:0.7:80:0.2[bass]`,
    `[1:a]volume=0.3,aecho=0.4:0.6:60:0.15[piano]`,
    `[2:a]volume=0.2,aecho=0.3:0.5:70:0.12[chord]`,
    `[3:a]volume=0.12,vibrato=f=0.8:d=0.3[mel]`,
    `[4:a]volume=0.07[hi]`,
    `[bass][piano][chord][mel][hi]amix=inputs=5:normalize=0,afade=t=in:st=0:d=1,afade=t=out:st=${d - 2}:d=2[out]`,
  ].join(';');
  return { inputs, filterComplex: fc };
}

function buildDramaticTension() {
  const d = DURATION;
  const inputs = [
    `sine=frequency=55:sample_rate=44100:duration=${d}`,
    `sine=frequency=58:sample_rate=44100:duration=${d}`,
    `sine=frequency=82:sample_rate=44100:duration=${d}`,
    `sine=frequency=110:sample_rate=44100:duration=${d}`,
    `sine=frequency=165:sample_rate=44100:duration=${d}`,
  ];
  const fc = [
    `[0:a]volume=0.5,aecho=0.7:0.9:600:0.6[drone]`,
    `[1:a]volume=0.4,aecho=0.6:0.8:500:0.5[dis]`,
    `[2:a]volume=0.35,aecho=0.5:0.7:400:0.4[e2]`,
    `[3:a]volume=0.25,vibrato=f=0.5:d=0.4[tension]`,
    `[4:a]volume=0.15,tremolo=f=1:d=0.5[hi]`,
    `[drone][dis][e2][tension][hi]amix=inputs=5:normalize=0,afade=t=in:st=0:d=4,afade=t=out:st=${d - 1.5}:d=1.5[out]`,
  ].join(';');
  return { inputs, filterComplex: fc };
}

function buildPlayfulBounce() {
  const d = DURATION;
  const inputs = [
    `sine=frequency=130:sample_rate=44100:duration=${d}`,
    `sine=frequency=261:sample_rate=44100:duration=${d}`,
    `sine=frequency=523:sample_rate=44100:duration=${d}`,
    `sine=frequency=659:sample_rate=44100:duration=${d}`,
    `sine=frequency=784:sample_rate=44100:duration=${d}`,
  ];
  const fc = [
    `[0:a]volume=0.45,tremolo=f=4:d=0.6[bass]`,
    `[1:a]volume=0.3,tremolo=f=4:d=0.5[mid]`,
    `[2:a]volume=0.28,tremolo=f=6:d=0.6[mel]`,
    `[3:a]volume=0.18,tremolo=f=6:d=0.5[harm]`,
    `[4:a]volume=0.13,tremolo=f=8:d=0.7[spark]`,
    `[bass][mid][mel][harm][spark]amix=inputs=5:normalize=0,afade=t=in:st=0:d=0.3,afade=t=out:st=${d - 1}:d=1[out]`,
  ].join(';');
  return { inputs, filterComplex: fc };
}

// ─── Generator ───────────────────────────────────────────────────────────────

function generateTrack(track) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(MUSIC_DIR, `${track.id}.mp3`);
    console.log(`  Generating: ${track.name} (${track.mood})...`);

    const { inputs, filterComplex } = track.build();

    const args = ['-y'];
    for (const input of inputs) {
      args.push('-f', 'lavfi', '-i', input);
    }
    args.push(
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      outputPath
    );

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        console.error(`  ✗ Failed: ${track.id}\n  ${stderr.slice(-300)}`);
        reject(new Error(stderr.slice(-150)));
      } else {
        const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
        console.log(`  ✓ ${track.name} → ${(size / 1024).toFixed(0)}KB`);
        resolve(outputPath);
      }
    });
  });
}

async function generateAll() {
  console.log('🎵 DemoReel Music Generator\n');
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  console.log(`Output: ${MUSIC_DIR}\n`);
  let success = 0, failed = 0;
  for (const track of TRACKS) {
    try { await generateTrack(track); success++; }
    catch (e) { console.error(`  Error: ${e.message.slice(0, 80)}`); failed++; }
  }
  console.log(`\n✅ Done! ${success} generated, ${failed} failed.`);
  if (success > 0) {
    console.log('\nTracks:');
    TRACKS.forEach(t => {
      const p = path.join(MUSIC_DIR, `${t.id}.mp3`);
      if (fs.existsSync(p)) console.log(`  • ${t.id}.mp3 (${(fs.statSync(p).size / 1024).toFixed(0)}KB) — ${t.mood}`);
    });
  }
}

const TRACK_METADATA = TRACKS.map(t => ({
  id: t.id, name: t.name, mood: t.mood, description: t.description, duration: DURATION,
}));

module.exports = { TRACK_METADATA, MUSIC_DIR };

if (require.main === module) {
  generateAll().catch(console.error);
}
