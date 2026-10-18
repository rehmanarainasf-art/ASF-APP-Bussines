import { pageHead } from '@/lib/meta';
import { createFileRoute } from '@tanstack/react-router';
import { CommunitiesScreen } from '@/components/asf/Screens';
export const Route = createFileRoute('/communities')({ head: () => pageHead('Communities', 'ASF communities — your messenger, connected.'), component: CommunitiesScreen });
