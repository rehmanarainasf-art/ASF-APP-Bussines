import { createFileRoute } from "@tanstack/react-router";
import { Messenger } from '@/components/asf/Messenger';
import { pageHead } from '@/lib/meta';
export const Route = createFileRoute("/")({
  head: () => pageHead('Chats', 'Your ASF conversations, contacts and business messages in one place.'),
  component: Messenger,
});
