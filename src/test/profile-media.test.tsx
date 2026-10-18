import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaUrl } from '@/components/asf/MediaView';
import { PeerAvatar } from '@/components/asf/Avatar';

const media = vi.hoisted(() => ({ mediaUrl: vi.fn() }));
vi.mock('@/lib/media', () => media);
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('Account-safe profile photos', () => {
  it('stays empty when no photo was uploaded', () => {
    render(<PeerAvatar name="Empty account" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByLabelText('Empty account')).toHaveAttribute('data-blank-avatar');
    expect(media.mediaUrl).not.toHaveBeenCalled();
  });

  it('never displays legacy sample portraits', () => {
    render(<PeerAvatar name="Account" path="/assets/avatar-4-old.jpg" />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('hides a real photo when the contact is blocked', () => {
    render(<PeerAvatar name="Blocked contact" path="https://example.test/photo.jpg" blocked />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByLabelText('Blocked contact')).toHaveClass('text-destructive');
  });

  it('never reuses one account photo while another path is loading', async () => {
    let resolveNext: ((url: string) => void) | undefined;
    media.mediaUrl.mockResolvedValueOnce('https://example.test/first.jpg')
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveNext = resolve; }));
    const { result, rerender } = renderHook(({ path }) => useMediaUrl(path), { initialProps: { path: 'first/photo.jpg' } });
    await waitFor(() => expect(result.current).toBe('https://example.test/first.jpg'));
    rerender({ path: 'second/photo.jpg' });
    expect(result.current).toBeNull();
    await act(async () => { resolveNext?.('https://example.test/second.jpg'); });
    expect(result.current).toBe('https://example.test/second.jpg');
    rerender({ path: '' });
    expect(result.current).toBeNull();
  });
});