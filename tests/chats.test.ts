import { describe, expect, test } from 'vitest';
import { answerChats, connectChats } from '../lib/chats/connection';
import type { ChatId } from '../lib/telegram/chats';
import { createFakeChats, FAKE_PHOTO } from '../lib/telegram/fake';

describe('chat list messages', () => {
  test('lists chats through the service worker', async () => {
    // Given: a worker that holds the default fake chat list
    const answer = answerChats(() => createFakeChats({ scenario: 'default' }));
    // When
    const chats = await connectChats((request) => answer(request)!).list();
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
    const answer = answerChats(() => createFakeChats({ scenario: 'default' }));
    // When
    const photo = await connectChats((request) => answer(request)!).photo(7005 as ChatId);
    // Then
    expect(photo).toBe(FAKE_PHOTO);
  });

  test('fails when the service worker has no chat list', async () => {
    // Given: a worker that has not loaded Telegram yet
    const answer = answerChats(() => null);
    // When
    const list = connectChats((request) => answer(request)!).list();
    // Then
    await expect(list).rejects.toThrow('chats');
  });
});
