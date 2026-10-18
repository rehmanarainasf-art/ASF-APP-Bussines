import { pageHead } from '@/lib/meta';
import { createFileRoute } from '@tanstack/react-router';
import { BusinessScreen } from '@/components/asf/Screens';
export const Route = createFileRoute('/business')({ head: () => pageHead('Tools', 'ASF tools — your messenger, connected.'), component: BusinessScreen });
