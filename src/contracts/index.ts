export * from './common.js';
export * from './envelope.js';
export * from './events.js';
export { CONTRACT_FIXTURES } from './fixtures.js';
export { integrationEventJsonSchemas } from './json-schema.js';
export * from './webhook.js';

import { IntegrationEvent } from './events.js';

/** Parses any incoming integration event (throws a ZodError listing every problem). */
export function parseIntegrationEvent(input: unknown): IntegrationEvent {
  return IntegrationEvent.parse(input);
}

/** Like parseIntegrationEvent but returns `{ success, data | error }` instead of throwing. */
export function safeParseIntegrationEvent(input: unknown) {
  return IntegrationEvent.safeParse(input);
}
