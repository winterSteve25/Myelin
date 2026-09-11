import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AudioRecordingCallbacks,
  attachAudioRecording,
  getAudioRecordingState,
  startAudioRecording,
  stopAudioRecordingsForOwner,
} from './recording';

class FakeMediaRecorder {
  public static isTypeSupported(): boolean {
    return true;
  }

  public state: 'inactive' | 'recording' = 'inactive';
  public readonly mimeType = 'audio/webm';
  public ondataavailable: ((event: { data: Blob }) => void) | null = null;
  public onstop: (() => void) | null = null;

  public constructor(public readonly stream: MediaStream) {}

  public start(): void {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob(['recorded']) });
  }

  public stop(): void {
    this.state = 'inactive';
    this.onstop?.();
  }
}

function callbacks(onStopped: AudioRecordingCallbacks['onStopped']) {
  return {
    onStateChange: vi.fn(),
    onStopped,
    onTranscriptionClaimed: vi.fn(),
    onTranscriptionClaimReleased: vi.fn(),
  } satisfies AudioRecordingCallbacks;
}

describe('audio recording lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the recorder alive while its view is detached and stops it by owner', async () => {
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })),
      },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const stopped = vi.fn();
    const firstCallbacks = callbacks(stopped);
    await expect(
      startAudioRecording('audio-1', 'note-1', 'owner-device', firstCallbacks),
    ).resolves.toBe(true);

    expect(getAudioRecordingState('audio-1')).toBe('recording');

    const remountedCallbacks = callbacks(stopped);
    const detach = attachAudioRecording('audio-1', remountedCallbacks);
    detach();

    await stopAudioRecordingsForOwner('note-1');

    expect(stopped).toHaveBeenCalledOnce();
    expect(stopped.mock.calls[0]![0].chunks).toHaveLength(1);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(getAudioRecordingState('audio-1')).toBe('idle');
  });
});
