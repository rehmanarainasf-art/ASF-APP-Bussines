import { pageHead } from '@/lib/meta';
import { createFileRoute } from '@tanstack/react-router';
import { ChannelsScreen } from '@/components/asf/Screens';
export const Route = createFileRoute('/channels')({ head: () => pageHead('Channels', 'ASF channels — your messenger, connected.'), component: ChannelsScreen });
