import { storage } from 'wxt/utils/storage';
import type { Chat } from './telegram/chats';

/** `account` is the Telegram user id of the account that saved `chat`. */
export type TargetChat = { account: number; chat: Chat };

// saveTargetChat is the only writer of this item.
export const targetChat = storage.defineItem<TargetChat | null>('local:targetChat', {
  fallback: null,
});

/** The saved chat when `account` saved it, else null: links never go to another account's chat. */
export function targetChatFor(saved: TargetChat | null, account: number): Chat | null {
  return saved?.account === account ? saved.chat : null;
}

export async function readTargetChat(account: number): Promise<Chat | null> {
  return targetChatFor(await targetChat.getValue(), account);
}

/** Calls back with `account`'s target chat now, then after every save from any tab. */
export function watchTargetChat(
  account: number,
  onChange: (chat: Chat | null) => void,
): () => void {
  let live = true;
  void targetChat.getValue().then((value) => {
    if (live) onChange(targetChatFor(value, account));
  });
  const unwatch = targetChat.watch((value) => onChange(targetChatFor(value, account)));
  return () => {
    live = false;
    unwatch();
  };
}

export async function saveTargetChat(account: number, chat: Chat): Promise<void> {
  await targetChat.setValue({ account, chat });
}
