import { pageHead } from '@/lib/meta';
import { createFileRoute } from '@tanstack/react-router';
import { MediaScreen } from '@/components/asf/Screens';
export const Route = createFileRoute('/media')({ head: () => pageHead('Media', 'ASF media — your messenger, connected.'), component: MediaScreen });
