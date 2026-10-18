import { createContext, useContext } from 'react';

export type CallPeer = { id: string; name: string; avatar?: string | null | undefined; number?: string | undefined };
type Phase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';
export type CallState = { phase: Phase; callId: string | null; peer: CallPeer | null; video: boolean; startedAt: number | null; incoming?: boolean };
export type CallLog = { id: string; name: string; number: string; peerId?: string; video: boolean; at: number; dir?: 'out' | 'in' | 'missed'; duration?: number; sched?: string };

type Ctx = {
  call: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  /** True while the person being called has the app open with internet (so their phone is really ringing). */
  peerOnline: boolean;
  startCall: (peer: CallPeer, video: boolean) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  sharing: boolean;
  toggleShare: () => Promise<void>;
  sendText: (text: string) => Promise<void>;
};

// Keep context identity outside the provider's Fast Refresh boundary.
export const CallContext = createContext<Ctx | null>(null);

export function useCall() {
  const c = useContext(CallContext);
  if (!c) throw new Error('useCall must be used inside CallProvider');
  return c;
}