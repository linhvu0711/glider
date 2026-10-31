import type { LoginService } from './service';
import type { LoginCommand, LoginView } from './state';

export interface LoginConnection {
  send(command: LoginCommand): void;
  subscribe(listener: (view: LoginView) => void): () => void;
}

export function connectInMemory(service: LoginService): LoginConnection {
  return {
    send: (command) => service.send(command),
    subscribe: (listener) => service.subscribe(listener),
  };
}
