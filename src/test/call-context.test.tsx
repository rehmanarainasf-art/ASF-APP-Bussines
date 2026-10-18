import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CallProvider, useCall } from '@/lib/call-context';

const mocks = vi.hoisted(() => ({
  channel: vi.fn(), removeChannel: vi.fn(), rpc: vi.fn(), insert: vi.fn(), saveData: vi.fn(),
  handler: undefined as undefined | ((payload: { new: unknown }) => Promise<void>),
}));
vi.mock('@/lib/asf-context', () => ({ useAsf: () => ({ user: { id: 'me' }, data: {}, saveData: mocks.saveData }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  channel: mocks.channel, removeChannel: mocks.removeChannel, rpc: mocks.rpc,
  from: () => ({ insert: mocks.insert, select: () => { const query = { eq: () => query, maybeSingle: async () => ({ data: { id: 'chat-1' } }) }; return query; } }),
} }));
let current: ReturnType<typeof useCall>;
function Consumer() { current = useCall(); return <span>{current.call.phase}</span>; }
const incoming = { call_id: 'call-1', from_id: 'peer', kind: 'offer', video: false, payload: { type: 'offer', sdp: 'test' }, created_at: new Date().toISOString() };

describe('Call signalling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockResolvedValue({ error: null });
    mocks.rpc.mockResolvedValue({ data: [] });
    mocks.channel.mockImplementation(() => {
      const channel = { on: (_event: string, _filter: unknown, handler: typeof mocks.handler) => { mocks.handler = handler; return channel; }, subscribe: () => channel };
      return channel;
    });
  });
  it('keeps the listener subscribed when call state and account callbacks re-render', async () => {
    const view = render(<CallProvider><Consumer /></CallProvider>);
    await act(async () => { await mocks.handler?.({ new: incoming }); });
    expect(current.call.phase).toBe('incoming');
    view.rerender(<CallProvider><Consumer /></CallProvider>);
    // Only the signalling channel is under test; the separate presence channel is allowed.
    expect(mocks.channel.mock.calls.filter(([name]) => String(name).startsWith('calls-'))).toHaveLength(1);
    expect(mocks.removeChannel).not.toHaveBeenCalled();
  });
  it('does not send busy or overwrite the call for a duplicate offer', async () => {
    render(<CallProvider><Consumer /></CallProvider>);
    await act(async () => { await Promise.all([mocks.handler?.({ new: incoming }), mocks.handler?.({ new: incoming })]); });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(current.call.callId).toBe('call-1');
  });
  it('does not resurrect an incoming call ended during profile lookup', async () => {
    let resolve: ((value: { data: never[] }) => void) | undefined;
    mocks.rpc.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<CallProvider><Consumer /></CallProvider>);
    let pending: Promise<void> | undefined;
    await act(async () => { pending = mocks.handler?.({ new: incoming }); });
    await act(async () => { await mocks.handler?.({ new: { ...incoming, kind: 'end' } }); resolve?.({ data: [] }); await pending; });
    await waitFor(() => expect(current.call.phase).toBe('idle'));
  });
  it('records an outgoing call ended while microphone permission is pending without sending a later offer', async () => {
    let resolveMedia: ((s: MediaStream) => void) | undefined;
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise<MediaStream>((resolve) => { resolveMedia = resolve; }) } });
    render(<CallProvider><Consumer /></CallProvider>);
    let pending: Promise<void> | undefined;
    await act(async () => { pending = current.startCall({ id: 'peer', name: 'Contact', number: '03' }, false); });
    expect(current.call.phase).toBe('outgoing');
    await act(async () => { current.hangup(); resolveMedia?.(stream); await pending; });
    expect(current.call.phase).toBe('idle');
    expect(stop).toHaveBeenCalled();
    expect(mocks.saveData).toHaveBeenCalledWith(expect.objectContaining({ calls: [expect.objectContaining({ peerId: 'peer', dir: 'out', duration: 0 })] }));
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ chat_id: 'chat-1', media_type: 'call/voice', body: 'missed' }));
    expect(mocks.insert.mock.calls.some(([row]) => row.kind === 'offer')).toBe(false);
  });
});