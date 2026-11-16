// Sound and video for the checks, made with ffmpeg into this run's own temp folder the first time each is asked for.
// Nothing here is kept: the folder is deleted when the run ends.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const tone = (hz, sec) => ['-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${sec}:sample_rate=44100`];
// name -> { args: ffmpeg arguments before the output file, seconds: the length asked for }
const RECIPES = {
  'Checks - Song A.mp3': { seconds: 6, args: [...tone(440, 6), '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', '-metadata', 'title=Song A', '-metadata', 'artist=Checks'] },
  'Checks - Song B.wav': { seconds: 5, args: [...tone(660, 5), '-ac', '2', '-c:a', 'pcm_s16le'] },
  'clip.wav': { seconds: 5, args: [...tone(523, 5), '-ac', '2', '-c:a', 'pcm_s16le'] },
  'join-1.wav': { seconds: 2, args: [...tone(330, 2), '-ac', '2', '-c:a', 'pcm_s16le'] },
  // a low sample rate, as voice recordings from the web often have: AAC and Opus encoders do not work at it
  'low-rate.mp3': { seconds: 4, args: [...tone(440, 4), '-ar', '22050', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '64k'] },
  // a call with each person on their own side: 300 Hz on the left, 1000 Hz on the right
  'two-sides.mp3': { seconds: 4, args: ['-f', 'lavfi', '-i', 'sine=frequency=300:duration=4:sample_rate=22050', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=4:sample_rate=22050', '-filter_complex', '[0:a][1:a]join=inputs=2:channel_layout=stereo', '-c:a', 'libmp3lame', '-b:a', '96k', '-joint_stereo', '0'] },
  'join-2.mp3': { seconds: 3, args: [...tone(440, 3), '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k'] },
  'join-3.m4a': { seconds: 1.5, args: [...tone(550, 1.5), '-ac', '2', '-c:a', 'aac', '-b:a', '128k'] },
  // a picture with AC-3 sound: no browser decodes AC-3, so an exact cut must be refused and an untouched one must work
  'ac3-sound.mkv': { seconds: 4, args: ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=4', ...tone(440, 4), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '25', '-preset', 'ultrafast', '-c:a', 'ac3', '-b:a', '96k', '-ac', '2', '-shortest'] },
  'talk.mp3': { seconds: 30, args: [...tone(220, 30), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k'] },
  'private.mp3': { seconds: 30, args: [...tone(260, 30), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k'] },
  // 20 seconds with nobody speaking (a low hum), for the optional end-to-end recogniser check
  'nobody-speaking.wav': { seconds: 20, args: [...tone(110, 20), '-filter:a', 'volume=0.05', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le'] },
};

export function makeMedia(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    seconds: name => RECIPES[name].seconds,
    get(name) {
      const r = RECIPES[name]; if (!r) throw new Error(`no recipe for ${name}`);
      const out = path.join(dir, name);
      if (!fs.existsSync(out)) {
        const p = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...r.args, out], { encoding: 'utf8' });
        if (p.error) throw new Error(`ffmpeg is needed to make the test sound (${p.error.message})`);
        if (p.status !== 0 || !fs.existsSync(out)) throw new Error(`ffmpeg could not make ${name}: ${(p.stderr || '').trim().split('\n').pop()}`);
      }
      return out;
    },
  };
}
