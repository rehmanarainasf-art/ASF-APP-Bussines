import { pageHead } from '@/lib/meta';
import { createFileRoute } from '@tanstack/react-router';
import { StatusScreen } from '@/components/asf/Screens';
export const Route = createFileRoute('/status')({ head: () => pageHead('Updates', 'ASF updates — your messenger, connected.'), component: StatusScreen });
