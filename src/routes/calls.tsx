import { pageHead } from '@/lib/meta';
import { createFileRoute } from '@tanstack/react-router';
import { CallsScreen } from '@/components/asf/Screens';
export const Route = createFileRoute('/calls')({ head: () => pageHead('Calls', 'ASF calls — your messenger, connected.'), component: CallsScreen });
