import { connect, defineGroup, runtimePath, type Client, type MessagePath } from '../messages';
import type { SendService } from './service';
import type { LinkId, Page } from './state';

export const sendGroup = defineGroup('send', {
  open: (service: SendService, page: Page | null) => service.open(page),
  undo: (service: SendService, id: LinkId) => service.undo(id),
  retry: (service: SendService, id: LinkId) => service.retry(id),
  remove: (service: SendService, id: LinkId) => service.remove(id),
  view: (service: SendService) => service.view(),
});

export type SendConnection = Client<typeof sendGroup>;

// The popup's side. The popup asks view for its rows; the links stay in the background.
export function connectSend(path: MessagePath = runtimePath()): SendConnection {
  return connect(sendGroup, path);
}
