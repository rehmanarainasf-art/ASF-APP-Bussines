import { pageHead } from '@/lib/meta';
import { createFileRoute } from '@tanstack/react-router';
import { AnnouncementsScreen } from '@/components/asf/Screens';
export const Route = createFileRoute('/announcements')({ head: () => pageHead('Announcements', 'ASF announcements — your messenger, connected.'), component: AnnouncementsScreen });
