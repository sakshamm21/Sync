import ChatWorkspace from '@/components/chat/ChatWorkspace';
import { PageHeader } from '@/components/ui/surface';

export default function ChatPage() {
  return (
    <>
      <PageHeader
        kicker="One group chat per event"
        title={
          <>
            The <em>chats</em>
          </>
        }
        description="Talk to the organizer and everyone else who’s going."
      />
      <ChatWorkspace />
    </>
  );
}
