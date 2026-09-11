import { Logger } from '@myelin/shared/logger';
import { getPlatform } from '../../platform';
import type { AudioTranscriptionSession } from '../../platform/types';
import type { PeerMode } from '../../sync/live/peers';
import { shouldClaimOnRecordingStart } from './transcription-claims';

const logger = new Logger('AudioRecording');

export type AudioRecordingState = 'idle' | 'requesting' | 'recording';

export interface CompletedAudioRecording {
  chunks: Blob[];
  startedAt: number;
  mimeType: string;
  transcription: AudioTranscriptionSession | null;
}

export interface AudioRecordingCallbacks {
  onStateChange: (state: AudioRecordingState) => void;
  onStopped: (recording: CompletedAudioRecording) => void | Promise<void>;
  onTranscriptionClaimed: () => void;
  onTranscriptionClaimReleased: () => void;
}

interface ActiveAudioRecording {
  elementId: string;
  ownerNoteId: string;
  localMode: PeerMode;
  callbacks: AudioRecordingCallbacks;
  state: AudioRecordingState;
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
  transcription: AudioTranscriptionSession | null;
  chunks: Blob[];
  startedAt: number;
  stopRequested: boolean;
  claimed: boolean;
  completionPromise: Promise<void>;
  resolveCompletion: () => void;
}

const recordings = new Map<string, ActiveAudioRecording>();

function notifyState(entry: ActiveAudioRecording): void {
  entry.callbacks.onStateChange(entry.state);
}

function stopStream(entry: ActiveAudioRecording): void {
  entry.stream?.getTracks().forEach((track) => {
    track.stop();
  });
  entry.stream = null;
}

async function initializeRecording(
  entry: ActiveAudioRecording,
): Promise<boolean> {
  let stream: MediaStream | null = null;
  try {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      throw new Error('Audio recording is unavailable.');
    }

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (entry.stopRequested) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      return false;
    }
    entry.stream = stream;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    const transcription =
      (await getPlatform().transcription?.startSession({
        elementId: entry.elementId,
        stream,
      })) ?? null;
    entry.transcription = transcription;

    if (entry.stopRequested) {
      await transcription?.cancel();
      stopStream(entry);
      return false;
    }

    if (
      shouldClaimOnRecordingStart({
        transcriptionSessionStarted: transcription !== null,
        localMode: entry.localMode,
      })
    ) {
      entry.claimed = true;
      entry.callbacks.onTranscriptionClaimed();
    }

    entry.recorder = recorder;
    entry.startedAt = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        entry.chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      stopStream(entry);
      entry.state = 'idle';
      notifyState(entry);
      const completion: CompletedAudioRecording = {
        chunks: entry.chunks,
        startedAt: entry.startedAt,
        mimeType: recorder.mimeType,
        transcription: entry.transcription,
      };
      void Promise.resolve(entry.callbacks.onStopped(completion))
        .catch((error) => {
          logger.error('Failed to finalize audio recording', error, {
            elementId: entry.elementId,
          });
        })
        .finally(() => {
          if (recordings.get(entry.elementId) === entry) {
            recordings.delete(entry.elementId);
          }
          entry.resolveCompletion();
        });
    };

    recorder.start(100);
    transcription?.markRecordingStart();
    entry.state = 'recording';
    notifyState(entry);
    return true;
  } catch (error) {
    stopStream(entry);
    await entry.transcription?.cancel();
    if (entry.claimed) {
      entry.callbacks.onTranscriptionClaimReleased();
    }
    if (recordings.get(entry.elementId) === entry) {
      recordings.delete(entry.elementId);
    }
    logger.error('Failed to start audio recording', error, {
      elementId: entry.elementId,
    });
    return false;
  }
}

export async function startAudioRecording(
  elementId: string,
  ownerNoteId: string,
  localMode: PeerMode,
  callbacks: AudioRecordingCallbacks,
): Promise<boolean> {
  if (recordings.has(elementId)) {
    return false;
  }

  let resolveCompletion!: () => void;
  const completionPromise = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const entry: ActiveAudioRecording = {
    elementId,
    ownerNoteId,
    localMode,
    callbacks,
    state: 'requesting',
    recorder: null,
    stream: null,
    transcription: null,
    chunks: [],
    startedAt: 0,
    stopRequested: false,
    claimed: false,
    completionPromise,
    resolveCompletion,
  };
  recordings.set(elementId, entry);
  notifyState(entry);
  const started = await initializeRecording(entry);
  if (!started) {
    if (recordings.get(elementId) === entry) {
      recordings.delete(elementId);
    }
    entry.resolveCompletion();
  }
  return started;
}

export function getAudioRecordingState(elementId: string): AudioRecordingState {
  return recordings.get(elementId)?.state ?? 'idle';
}

export function getAudioRecordingElapsedSeconds(elementId: string): number {
  const entry = recordings.get(elementId);
  return entry?.startedAt
    ? Math.max(0, (Date.now() - entry.startedAt) / 1000)
    : 0;
}

export function hasAudioRecordingsForOwner(ownerNoteId: string): boolean {
  return Array.from(recordings.values()).some(
    (entry) => entry.ownerNoteId === ownerNoteId,
  );
}

export function attachAudioRecording(
  elementId: string,
  callbacks: AudioRecordingCallbacks,
): () => void {
  const entry = recordings.get(elementId);
  if (!entry) {
    callbacks.onStateChange('idle');
    return () => {};
  }

  entry.callbacks = callbacks;
  callbacks.onStateChange(entry.state);
  return () => {};
}

export function stopAudioRecording(elementId: string): Promise<void> | null {
  const entry = recordings.get(elementId);
  if (!entry) {
    return null;
  }

  entry.stopRequested = true;
  const recorder = entry.recorder;
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  }
  return entry.completionPromise;
}

export function stopAudioRecordingsForOwner(
  ownerNoteId: string,
): Promise<void> | null {
  const pending = Array.from(recordings.values())
    .filter((entry) => entry.ownerNoteId === ownerNoteId)
    .map((entry) => stopAudioRecording(entry.elementId));
  const promises = pending.filter(
    (promise): promise is Promise<void> => promise !== null,
  );
  return promises.length > 0
    ? Promise.all(promises).then(() => undefined)
    : null;
}
