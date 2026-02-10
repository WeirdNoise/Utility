import { AudioFormat, ConverterConfig } from '../types';

/**
 * Converts an AudioBuffer to a WAV Blob.
 */
function bufferToWave(abuffer: AudioBuffer, len: number): Blob {
  let numOfChan = abuffer.numberOfChannels;
  let length = len * numOfChan * 2 + 44;
  let buffer = new ArrayBuffer(length);
  let view = new DataView(buffer);
  let channels = [] as Float32Array[];
  let i: number;
  let sample: number;
  let offset = 0;
  let pos = 0;

  // Write WAV Header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this example)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // Write interleaved data
  for (i = 0; i < abuffer.numberOfChannels; i++)
    channels.push(abuffer.getChannelData(i));

  while (pos < len) {
    for (i = 0; i < numOfChan; i++) {
      // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
      view.setInt16(offset, sample, true); // write 16-bit sample
      offset += 2;
    }
    pos++;
  }

  return new Blob([buffer], { type: "audio/wav" });

  function setUint16(data: number) {
    view.setUint16(offset, data, true);
    offset += 2;
  }

  function setUint32(data: number) {
    view.setUint32(offset, data, true);
    offset += 4;
  }
}

/**
 * Encodes AudioBuffer to MP3 using lamejs (Global)
 */
async function encodeMp3(
  audioBuffer: AudioBuffer, 
  bitrate: number, 
  onProgress: (p: number) => void
): Promise<Blob> {
  // Access global lamejs loaded via script tag
  const lamejs = (window as any).lamejs;
  if (!lamejs) {
    throw new Error("La bibliothèque lamejs n'est pas chargée.");
  }

  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const left = audioBuffer.getChannelData(0);
  const right = channels > 1 ? audioBuffer.getChannelData(1) : null;
  
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, bitrate);
  const mp3Data = [];
  
  const sampleBlockSize = 1152; // Must be multiple of 576
  const length = left.length;
  
  // Convert Float32 to Int16
  const left16 = new Int16Array(length);
  const right16 = right ? new Int16Array(length) : undefined;
  
  for(let i = 0; i < length; i++) {
     // Apply mild limiter/clamping to avoid distortion
     let val = Math.max(-1, Math.min(1, left[i]));
     left16[i] = val < 0 ? val * 0x8000 : val * 0x7FFF;
     
     if (right && right16) {
        let valR = Math.max(-1, Math.min(1, right[i]));
        right16[i] = valR < 0 ? valR * 0x8000 : valR * 0x7FFF;
     }
  }

  // Process in chunks to allow UI updates
  for (let i = 0; i < length; i += sampleBlockSize) {
    const leftChunk = left16.subarray(i, i + sampleBlockSize);
    const rightChunk = right16 ? right16.subarray(i, i + sampleBlockSize) : undefined;
    
    // @ts-ignore
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    // Yield to main thread every ~50 blocks (~1s of audio) to update progress
    if (i % (sampleBlockSize * 100) === 0) {
      const progress = 60 + Math.floor((i / length) * 40);
      onProgress(progress);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  // @ts-ignore
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  onProgress(100);
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

/**
 * Main conversion function using OfflineAudioContext for rendering and resampling
 */
export const convertAudio = async (
  sourceFile: File,
  config: ConverterConfig,
  onProgress: (progress: number) => void
): Promise<Blob> => {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  try {
    const arrayBuffer = await sourceFile.arrayBuffer();
    
    onProgress(10);
    
    // 1. Decode Original Audio
    const originalBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    onProgress(30);

    // 2. Prepare Offline Context for Resampling/Processing
    const offlineCtx = new OfflineAudioContext(
      originalBuffer.numberOfChannels,
      // Calculate new length based on ratio of sample rates
      Math.ceil(originalBuffer.length * (config.sampleRate / originalBuffer.sampleRate)),
      config.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = originalBuffer;
    source.connect(offlineCtx.destination);
    source.start();

    // 3. Render audio (Resampling happens here)
    const renderedBuffer = await offlineCtx.startRendering();
    
    onProgress(60);

    // 4. Encode to Target Format
    if (config.format === AudioFormat.WAV) {
      const blob = bufferToWave(renderedBuffer, renderedBuffer.length);
      onProgress(100);
      return blob;
    } 

    if (config.format === AudioFormat.MP3) {
      return await encodeMp3(renderedBuffer, config.bitrate, onProgress);
    }
    
    // For compressed formats (WebM, OGG), we use MediaRecorder if supported
    if (MediaRecorder.isTypeSupported(config.format)) {
      return await new Promise((resolve, reject) => {
        const streamDest = audioContext.createMediaStreamDestination();
        const recorder = new MediaRecorder(streamDest.stream, {
          mimeType: config.format,
          audioBitsPerSecond: config.bitrate * 1000
        });
        
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: config.format });
          onProgress(100);
          resolve(blob);
        };
        
        recorder.onerror = (e) => reject(e);

        // Play the rendered buffer into the stream
        const source = audioContext.createBufferSource();
        source.buffer = renderedBuffer;
        source.connect(streamDest);
        recorder.start();
        source.start();
        
        source.onended = () => {
          recorder.stop();
        };
      });
    } else {
      throw new Error(`Le navigateur ne supporte pas l'encodage natif en ${config.format}. Veuillez choisir WAV ou MP3.`);
    }

  } finally {
    // Always close audio context to prevent resource leaks
    if (audioContext.state !== 'closed') {
      audioContext.close();
    }
  }
};

export const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};