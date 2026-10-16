import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONTRACT_FIXTURES,
  INTEGRATION_EVENT_TYPES,
  INTEGRATION_EVENTS,
  integrationEventJsonSchemas,
  parseIntegrationEvent,
  safeParseIntegrationEvent,
} from '../src/contracts/index.js';

const clone = <T>(x: T): T => structuredClone(x);

describe('integration event contracts (D-153)', () => {
  it('covers exactly the eight events of the blueprint table', () => {
    expect([...INTEGRATION_EVENT_TYPES].sort()).toEqual(
      [
        'building.handover.requested',
        'identity.party.linked',
        'juristic.formed',
        'procurement.order.updated',
        'procurement.rfq.requested',
        'unit.transferred',
        'warranty.defect.closed',
        'warranty.defect.reported',
      ].sort(),
    );
  });

  it.each(INTEGRATION_EVENT_TYPES)(
    '%s: the fixture parses with its own schema and through the union',
    (type) => {
      const fixture = CONTRACT_FIXTURES[type];
      expect(INTEGRATION_EVENTS[type].schema.parse(fixture).type).toBe(type);
      expect(parseIntegrationEvent(fixture).type).toBe(type);
    },
  );

  it('rejects an unknown event type', () => {
    const e = clone(CONTRACT_FIXTURES['unit.transferred']);
    e.type = 'unit.sold';
    expect(safeParseIntegrationEvent(e).success).toBe(false);
  });

  it('rejects envelope mistakes: bad uuid, missing idempotency key, timestamp without offset, unknown platform', () => {
    const base = CONTRACT_FIXTURES['juristic.formed'];
    for (const mutate of [
      (e: Record<string, unknown>) => (e.eventId = 'not-a-uuid'),
      (e: Record<string, unknown>) => delete e.idempotencyKey,
      (e: Record<string, unknown>) => (e.occurredAt = '2026-10-17 09:00:00'),
      (e: Record<string, unknown>) => (e.sourcePlatform = 'getsomething'),
      (e: Record<string, unknown>) => (e.version = 2),
    ]) {
      const e = clone(base);
      mutate(e);
      expect(safeParseIntegrationEvent(e).success).toBe(false);
    }
  });

  it('rejects payload mistakes: money with 3 decimals, http URLs, empty unit lists, PII in clear', () => {
    const order = clone(CONTRACT_FIXTURES['procurement.order.updated']) as {
      payload: { price: { total: string } };
    };
    order.payload.price.total = '749.001';
    expect(safeParseIntegrationEvent(order).success).toBe(false);

    const defect = clone(CONTRACT_FIXTURES['warranty.defect.reported']) as {
      payload: { photos: string[]; reporter: unknown };
    };
    defect.payload.photos = ['http://insecure.example.invalid/p.jpg'];
    expect(safeParseIntegrationEvent(defect).success).toBe(false);

    const defect2 = clone(CONTRACT_FIXTURES['warranty.defect.reported']) as {
      payload: { reporter: unknown };
    };
    defect2.payload.reporter = { name: 'สมชาย', phone: '0812345678' };
    expect(safeParseIntegrationEvent(defect2).success).toBe(false);

    const handover = clone(CONTRACT_FIXTURES['building.handover.requested']) as {
      payload: { units: unknown[] };
    };
    handover.payload.units = [];
    expect(safeParseIntegrationEvent(handover).success).toBe(false);
  });

  it('ignores unknown fields (additive changes within a major version)', () => {
    const e = clone(CONTRACT_FIXTURES['identity.party.linked']) as Record<string, unknown> & {
      payload: Record<string, unknown>;
    };
    e.futureEnvelopeField = 1;
    e.payload.futurePayloadField = 'x';
    const parsed = parseIntegrationEvent(e) as unknown as Record<string, unknown> & {
      payload: Record<string, unknown>;
    };
    expect(parsed.futureEnvelopeField).toBeUndefined();
    expect(parsed.payload.futurePayloadField).toBeUndefined();
  });

  it('the committed JSON Schemas (schemas/*.json) match the zod source', () => {
    const schemas = integrationEventJsonSchemas();
    expect(Object.keys(schemas).sort()).toEqual([...INTEGRATION_EVENT_TYPES, 'envelope'].sort());
    for (const [name, schema] of Object.entries(schemas)) {
      const committed = JSON.parse(
        readFileSync(join(import.meta.dirname, '..', 'schemas', `${name}.json`), 'utf8'),
      );
      expect(committed, `schemas/${name}.json is stale — run pnpm build`).toEqual(
        JSON.parse(JSON.stringify(schema)),
      );
    }
  });
});
