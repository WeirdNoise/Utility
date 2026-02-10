export enum AppMode {
  CONVERTER = 'CONVERTER',
  TRANSCRIBER = 'TRANSCRIBER',
  TTS = 'TTS'
}

export enum AudioFormat {
  WAV = 'audio/wav',
  WEBM = 'audio/webm',
  MP3 = 'audio/mpeg',
  OGG = 'audio/ogg',
  AAC = 'audio/aac',
  FLAC = 'audio/flac'
}

export enum SampleRate {
  HZ_44100 = 44100,
  HZ_48000 = 48000,
  HZ_22050 = 22050,
  HZ_16000 = 16000
}

export interface ConverterConfig {
  format: AudioFormat;
  bitrate: number; // in kbps, e.g., 128, 192, 320
  sampleRate: SampleRate;
}

export interface AudioFile {
  file: File;
  name: string;
  size: number;
  type: string;
  url: string;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  DONE = 'DONE',
  ERROR = 'ERROR'
}

export interface BatchFile extends AudioFile {
  id: string;
  status: ProcessingStatus;
  progress: number;
  outputBlob?: Blob;
  outputUrl?: string;
  error?: string;
}

export interface VoiceConfig {
  voiceName: string;
  languageCode: string;
  gender: 'MALE' | 'FEMALE';
}