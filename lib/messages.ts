import { browser } from 'wxt/browser';

/** What a page sends to the background, the one shape on the wire. */
export type Message = { group: string; action: string; args: unknown[] };

export type Reply = { ok: true; value: unknown } | { ok: false; error: string };

// `never` takes every service and argument type, so each action keeps its own.
type Action = (service: never, ...args: never[]) => Promise<unknown>;
type Actions = Record<string, Action>;

/** A feature's actions under one name; each action takes the feature's service first. */
export type Group<A extends Actions> = { readonly name: string; readonly actions: A };

type ServiceOf<A extends Actions> = Parameters<A[keyof A]>[0];

/** The page's side of a group: one method per action, with the arguments after the service. */
export type Client<G> =
  G extends Group<infer A>
    ? {
        [K in keyof A]: A[K] extends (service: never, ...args: infer P) => Promise<infer R>
          ? (...args: P) => Promise<R>
          : never;
      }
    : never;

export function defineGroup<A extends Actions>(name: string, actions: A): Group<A> {
  return { name, actions };
}

/** A group bound to the service its actions run on. */
export type Served = { readonly name: string; readonly actions: Actions; readonly service: unknown };

export function served<A extends Actions>(group: Group<A>, service: ServiceOf<A>): Served {
  return { name: group.name, actions: group.actions, service };
}

function isMessage(message: unknown): message is Message {
  return (
    typeof message === 'object' &&
    message !== null &&
    'group' in message &&
    typeof message.group === 'string' &&
    'action' in message &&
    typeof message.action === 'string' &&
    'args' in message &&
    Array.isArray(message.args)
  );
}

/** Undefined for a message that names no served group or action. */
function answer(list: Served[], message: unknown): Promise<Reply> | undefined {
  if (!isMessage(message)) return undefined;
  const target = list.find((item) => item.name === message.group);
  if (!target || !Object.hasOwn(target.actions, message.action)) return undefined;
  const action = target.actions[message.action] as (
    service: unknown,
    ...args: unknown[]
  ) => Promise<unknown>;
  // A throw before the action's first await is a failed reply too.
  return new Promise<unknown>((resolve) => resolve(action(target.service, ...message.args))).then(
    (value): Reply => ({ ok: true, value }),
    (error: unknown): Reply => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

// sendResponse with `return true` works in every Chrome version; a returned promise does not.
export function serve(list: Served[]) {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const reply = answer(list, message);
    if (!reply) return;
    void reply.then(sendResponse);
    return true;
  });
}

/** How a page reaches the background. Undefined when nothing answered. */
export interface MessagePath {
  ask(message: Message): Promise<Reply | undefined>;
}

export function runtimePath(): MessagePath {
  return { ask: (message) => browser.runtime.sendMessage(message) };
}

// Chrome sends only what survives JSON, so the tests' path does the same.
function overJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** The background in the same page, for tests: the same answers, with no runtime between. */
export function memoryPath(list: Served[]): MessagePath {
  return {
    async ask(message) {
      const reply = answer(list, overJson(message));
      return reply && overJson(await reply);
    },
  };
}

export function connect<A extends Actions>(group: Group<A>, path: MessagePath): Client<Group<A>> {
  const client: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const action of Object.keys(group.actions)) {
    client[action] = async (...args) => {
      const reply = await path.ask({ group: group.name, action, args });
      if (!reply) throw new Error('no answer');
      if (!reply.ok) throw new Error(reply.error);
      return reply.value;
    };
  }
  return client as Client<Group<A>>;
}
