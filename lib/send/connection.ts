import { connect, defineGroup, runtimePath, type Client, type MessagePath } from '../messages';
import type { SendService } from './service';
import type { LinkId, Page } from './state';

export const sendGroup = defineGroup('send', {
  open: (service: SendService, page: Page | null) => service.open(page),
  undo: (service: SendService, id: LinkId) => service.undo(id),
  retry: (service: SendService, id: LinkId) => service.retry(id),
  remove: (service: SendService, id: LinkId) => service.remove(id),
});

export type SendConnection = Client<typeof sendGroup>;

// The popup's side. The links themselves come from storage, not from these replies.
export function connectSend(path: MessagePath = runtimePath()): SendConnection {
  return connect(sendGroup, path);
}
