import { stopAudioRecordingsForOwner } from '@myelin/editor/elements/audio/recording';
import type { VFSNodeId } from '@/lib/sync';
import type { NoteSession } from '@/lib/sync/session';

const preservedSessions = new Map<VFSNodeId, NoteSession>();

export function preserveCanvasSession(session: NoteSession): void {
  preservedSessions.set(session.id, session);
}

export function takePreservedCanvasSession(
  noteId: VFSNodeId,
): NoteSession | null {
  const session = preservedSessions.get(noteId) ?? null;
  preservedSessions.delete(noteId);
  return session;
}

export function closePreservedCanvasSession(
  noteId: VFSNodeId,
): Promise<void> | null {
  const session = takePreservedCanvasSession(noteId);
  return session?.close() ?? null;
}

export function prepareCanvasTabClose(
  noteId: VFSNodeId,
): Promise<void> | undefined {
  const stopRecording = stopAudioRecordingsForOwner(noteId);
  if (stopRecording) {
    return stopRecording.then(async () => {
      await closePreservedCanvasSession(noteId);
    });
  }
  return closePreservedCanvasSession(noteId) ?? undefined;
}
