import { z } from 'zod';

import { EnvelopeBase } from './envelope.js';
import { INTEGRATION_EVENTS, type IntegrationEventType } from './events.js';

/**
 * JSON Schema (draft 2020-12) of every integration event envelope, for non-TypeScript consumers (getbuild
 * services in other languages, Pub/Sub schema registry). Committed under schemas/ by `pnpm build`; the test
 * suite fails when the committed files differ from the zod source.
 */
export function integrationEventJsonSchemas(): Record<
  IntegrationEventType | 'envelope',
  Record<string, unknown>
> {
  const out = {} as Record<IntegrationEventType | 'envelope', Record<string, unknown>>;
  out.envelope = withId(z.toJSONSchema(EnvelopeBase, { io: 'input' }), 'envelope');
  for (const [type, def] of Object.entries(INTEGRATION_EVENTS) as [
    IntegrationEventType,
    (typeof INTEGRATION_EVENTS)[IntegrationEventType],
  ][]) {
    out[type] = withId(z.toJSONSchema(def.schema, { io: 'input' }), type);
  }
  return out;
}

function withId(schema: Record<string, unknown>, name: string): Record<string, unknown> {
  return {
    $id: `https://schemas.collective.invalid/asset-core/${name}.json`,
    title: name,
    ...schema,
  };
}
