import { describe, expect, test } from 'vitest';
import { memoryPath, served } from '../lib/messages';
import { chatsGroup, connectChats, createChatList } from '../lib/target-chat';
import type { ChatId } from '../lib/telegram/chats';
import { createFakeChats, FAKE_PHOTO, LINH } from '../lib/telegram/fake';

describe('chat list messages', () => {
  test('lists chats through the service worker', async () => {
    // Given: a worker that holds the default fake chat list, Linh Vu logged in
    const fakeChats = createFakeChats({ scenario: 'default' });
    const path = memoryPath([served(chatsGroup, createChatList(async () => LINH.id, fakeChats))]);
    // When
    const chats = await connectChats(path).list();
    // Then
    expect(chats.map((chat) => chat.name)).toEqual([
      'Saved Messages',
      'Read Later Bot',
      'Tuan Vu',
      'Minh Anh',
      'Design Crew',
      'Hermes',
      'Glider News',
    ]);
  });

  test('gives a chat photo through the service worker', async () => {
    // Given: as above
    const fakeChats = createFakeChats({ scenario: 'default' });
    const path = memoryPath([served(chatsGroup, createChatList(async () => LINH.id, fakeChats))]);
    // When
    const photo = await connectChats(path).photo(7005 as ChatId);
    // Then
    expect(photo).toBe(FAKE_PHOTO);
  });

  test('fails when no one is logged in', async () => {
    // Given: as above, with no one logged in
    const list = createChatList(async () => null, createFakeChats({ scenario: 'default' }));
    // When
    const failed = await list.list().catch((error: Error) => error.message);
    // Then
    expect(failed).toBe('no account');
  });
});
