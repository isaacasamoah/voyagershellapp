const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const exec = promisify(execFile);
async function captureOutput(stateDir, label, action) {
  const sink = (await exec('pactl', ['get-default-sink'])).stdout.trim();
  assert.match(
    (await exec('pactl', ['get-sink-mute', sink])).stdout,
    /no/,
    'Output must be unmuted for the audio trial',
  );
  const recorder = spawn(
    'parec',
    [
      '--device',
      `${sink}.monitor`,
      '--format=s16le',
      '--rate=48000',
      '--channels=1',
      '--latency-msec=10',
      '--process-time-msec=10',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const chunks = [];
  let bytes = 0,
    error;
  recorder.on('error', (e) => {
    error = e;
  });
  recorder.stdout.on('data', (buffer) => {
    bytes += buffer.length;
    if (bytes > 2880000) {
      error = Error('Audio trial exceeded its bounded capture');
      recorder.kill();
      return;
    }
    let peak = 0;
    for (let i = 0; i + 1 < buffer.length; i += 2)
      peak = Math.max(peak, Math.abs(buffer.readInt16LE(i)));
    chunks.push({ at: performance.now(), buffer, peak });
  });
  try {
    await delay(300);
    assert(!error, error?.message);
    assert.equal(recorder.exitCode, null, 'Output recorder exited during the trial');
    assert.equal(recorder.signalCode, null, 'Output recorder was interrupted');
    assert(chunks.length, 'Audio monitor produced no samples');
    assert(
      chunks.every((c) => c.peak < 20),
      'Other output audio is present; cannot attribute the docking tone',
    );
    chunks.length = 0;
    bytes = 0;
    const started = performance.now();
    const result = await action();
    await delay(400);
    assert(!error, error?.message);
    assert.equal(recorder.exitCode, null, 'Output recorder exited during the trial');
    assert.equal(recorder.signalCode, null, 'Output recorder was interrupted');
    assert(chunks.length, 'Audio monitor stopped delivering samples');
    const sounding = chunks.filter((c) => c.peak >= 20);
    const samples = Buffer.concat(chunks.map((c) => c.buffer));
    const header = Buffer.alloc(44);
    header.write('RIFF');
    header.writeUInt32LE(samples.length + 36, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(48000, 24);
    header.writeUInt32LE(96000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(samples.length, 40);
    await fs.writeFile(path.join(stateDir, `${label}.wav`), Buffer.concat([header, samples]));
    return {
      result,
      audio: {
        sink,
        started,
        onsetObservedAt: sounding[0]?.at ?? null,
        endObservedAt: sounding.at(-1)?.at ?? null,
        peak: Math.max(0, ...chunks.map((c) => c.peak)),
        chunks: sounding.length,
        measurement:
          'Unmuted output monitor PCM, timestamps at chunk receipt. These are conservative observation times, not room microphone measurements.',
      },
    };
  } finally {
    if (recorder.pid && recorder.exitCode === null && recorder.signalCode === null) {
      const exited = new Promise((resolve) => recorder.once('exit', resolve));
      recorder.kill('SIGTERM');
      await exited;
    }
  }
}
module.exports = { captureOutput };
