import { connect, defineGroup, runtimePath, type MessagePath } from '../messages';
import type { ChatId, TelegramChats } from '../telegram/chats';

function loaded(get: () => TelegramChats | null): TelegramChats {
  const chats = get();
  if (!chats) throw new Error('chats');
  return chats;
}

export const chatsGroup = defineGroup('chats', {
  list: (get: () => TelegramChats | null) => loaded(get).list(),
  photo: (get: () => TelegramChats | null, id: ChatId) => loaded(get).photo(id),
});

// The page's side. Chat asks are per tab, unlike the login view, which goes to every tab.
export function connectChats(path: MessagePath = runtimePath()): TelegramChats {
  const asks = connect(chatsGroup, path);
  return {
    list: () =>
      asks.list().catch(() => {
        throw new Error('chats');
      }),
    photo: (id) => asks.photo(id).catch(() => null),
  };
}
