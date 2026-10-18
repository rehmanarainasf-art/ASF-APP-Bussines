import { pageHead } from '@/lib/meta';
import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/ai/')({ head: () => pageHead('AI conversations', 'Your saved ASF AI conversations.'), beforeLoad: () => { throw redirect({ to: '/ai/$threadId', params: { threadId: 'new' } }); } });
