import { pageHead } from '@/lib/meta';
import { createFileRoute } from '@tanstack/react-router';
import { SettingsScreen } from '@/components/asf/Screens';
export const Route = createFileRoute('/settings')({ head: () => pageHead('Settings', 'ASF settings — your messenger, connected.'), component: SettingsScreen });
