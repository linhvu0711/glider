import { useEffect, useState } from 'react';
import type { Chat, ChatId, TelegramChats } from '../lib/telegram/chats';
import { BookmarkIcon } from './icons';

// Picked by id, so a chat keeps its color in every list (mockup frame 1).
const AVATAR_COLORS = ['#2563eb', '#db2777', '#059669', '#b45309', '#7c3aed', '#0891b2', '#dc2626'];

export function ChatAvatar({ chat, chats }: { chat: Chat; chats: TelegramChats }) {
  const photo = usePhoto(chat, chats);
  if (chat.kind === 'self') {
    return (
      <span className="avatar chat-avatar" style={{ background: 'var(--accent)' }}>
        <BookmarkIcon width={16} height={16} />
      </span>
    );
  }
  if (photo) return <img className="avatar-photo" alt="" src={photo} />;
  return (
    <span
      className="avatar chat-avatar"
      style={{ background: AVATAR_COLORS[Math.abs(chat.id) % AVATAR_COLORS.length] }}
    >
      <span>{chat.initials}</span>
    </span>
  );
}

// One ask per chat for the life of the page.
const photoAsks = new WeakMap<TelegramChats, Map<ChatId, Promise<string | null>>>();

function usePhoto(chat: Chat, chats: TelegramChats): string | null {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    if (!chat.hasPhoto) return;
    let live = true;
    let asks = photoAsks.get(chats);
    if (!asks) {
      asks = new Map();
      photoAsks.set(chats, asks);
    }
    let ask = asks.get(chat.id);
    if (!ask) {
      ask = chats.photo(chat.id);
      asks.set(chat.id, ask);
    }
    void ask.then((url) => {
      if (live) setPhoto(url);
    });
    return () => {
      live = false;
    };
  }, [chat.id, chat.hasPhoto, chats]);
  return photo;
}
