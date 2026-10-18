import { pageHead } from '@/lib/meta';
import { createFileRoute } from '@tanstack/react-router';
import { ProfileScreen } from '@/components/asf/Screens';
export const Route = createFileRoute('/profile')({ head: () => pageHead('Profile', 'ASF profile — your messenger, connected.'), component: ProfileScreen });
