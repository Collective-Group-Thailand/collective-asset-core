import type { IntegrationEventType } from './events.js';

/**
 * One valid example per integration event (fake data only). Consumers use them in their own contract tests;
 * this package's tests parse every fixture and prove that typical mistakes are rejected.
 */
const base = {
  version: 1,
  occurredAt: '2026-10-17T09:00:00+07:00',
  correlationId: '0199f1c2-7a00-7000-8000-00000000c0de',
} as const;

export const CONTRACT_FIXTURES: Record<IntegrationEventType, Record<string, unknown>> = {
  'building.handover.requested': {
    ...base,
    eventId: '0199f1c2-7a00-7000-8000-000000000001',
    type: 'building.handover.requested',
    idempotencyKey: 'getbuild:handover:prj-001:bldg-a',
    sourcePlatform: 'getbuild',
    tenantId: '0199f1c2-7a00-7000-8000-0000000000d1',
    payload: {
      developerTenantRef: 'dev-tenant-42',
      requestedHandoverAt: '2026-11-01T10:00:00+07:00',
      property: {
        ref: 'prj-001',
        code: 'PRJ1',
        name: 'โครงการตัวอย่าง',
        address: { province: 'กรุงเทพมหานคร', postcode: '10110' },
      },
      building: { ref: 'bldg-a', code: 'A', name: 'อาคาร A', type: 'condo', floorsCount: 8 },
      floors: [{ ref: 'fl-1', level: 1, name: 'ชั้น 1' }],
      units: [
        {
          ref: 'u-101',
          floorRef: 'fl-1',
          unitNo: 'A-101',
          type: 'condo_unit',
          areaSqm: '32.50',
          ownershipRatio: '0.012345',
        },
      ],
      parties: [
        {
          ref: 'p-1',
          type: 'person',
          displayName: 'ผู้ซื้อ ตัวอย่าง',
          phone: { enc: 'ZmFrZS1lbmNyeXB0ZWQtcGhvbmU=' },
        },
      ],
      unitOwnerships: [{ unitRef: 'u-101', partyRef: 'p-1', sharePct: '100', validFrom: '2026-10-01' }],
      defects: [],
      warrantyTerms: [{ scope: 'unit', ref: 'u-101', startsOn: '2026-10-01', endsOn: '2028-09-30' }],
      documents: [
        {
          ref: 'doc-1',
          kind: 'as_built',
          url: 'https://files.example.invalid/as-built.pdf',
          sha256: 'a'.repeat(64),
        },
      ],
      assetItems: [{ ref: 'ai-1', category: 'pump', name: 'ปั๊มน้ำ 1' }],
    },
  },
  'unit.transferred': {
    ...base,
    eventId: '0199f1c2-7a00-7000-8000-000000000002',
    type: 'unit.transferred',
    idempotencyKey: 'getbuild:transfer:u-101',
    sourcePlatform: 'getbuild',
    tenantId: '0199f1c2-7a00-7000-8000-0000000000d1',
    payload: {
      buildingRef: 'bldg-a',
      unitRef: 'u-101',
      buyer: {
        ref: 'p-1',
        type: 'person',
        displayName: 'ผู้ซื้อ ตัวอย่าง',
        lineUserId: 'Ufake0000000000000000000000000001',
      },
      transferDate: '2026-10-15',
      rentalIntent: true,
      warrantyStartsOn: '2026-10-15',
    },
  },
  'warranty.defect.reported': {
    ...base,
    eventId: '0199f1c2-7a00-7000-8000-000000000003',
    type: 'warranty.defect.reported',
    idempotencyKey: 'getproperty:service_request:0199f1c2-7a00-7000-8000-0000000000a1:reported',
    sourcePlatform: 'getproperty',
    tenantId: '0199f1c2-7a00-7000-8000-0000000000e1',
    payload: {
      serviceRequestId: '0199f1c2-7a00-7000-8000-0000000000a1',
      buildingRef: 'bldg-a',
      unitRef: 'u-101',
      category: 'plumbing',
      description: 'น้ำรั่วใต้อ่างล้างหน้า',
      photos: ['https://files.example.invalid/photo-1.jpg'],
      reportedAt: '2026-10-17T08:30:00+07:00',
      reporter: { enc: 'ZmFrZS1lbmNyeXB0ZWQtcmVwb3J0ZXI=' },
    },
  },
  'warranty.defect.closed': {
    ...base,
    eventId: '0199f1c2-7a00-7000-8000-000000000004',
    type: 'warranty.defect.closed',
    idempotencyKey: 'getbuild:defect:def-9:closed',
    sourcePlatform: 'getbuild',
    tenantId: '0199f1c2-7a00-7000-8000-0000000000d1',
    payload: {
      defectRef: 'def-9',
      serviceRequestId: '0199f1c2-7a00-7000-8000-0000000000a1',
      resolution: 'fixed',
      closedAt: '2026-10-20T15:00:00+07:00',
      afterPhotos: [],
    },
  },
  'juristic.formed': {
    ...base,
    eventId: '0199f1c2-7a00-7000-8000-000000000005',
    type: 'juristic.formed',
    idempotencyKey: 'getproperty:building:0199f1c2-7a00-7000-8000-0000000000b1:juristic_formed',
    sourcePlatform: 'getproperty',
    tenantId: '0199f1c2-7a00-7000-8000-0000000000e1',
    payload: {
      buildingId: '0199f1c2-7a00-7000-8000-0000000000b1',
      buildingRef: 'bldg-a',
      juristicTenantId: '0199f1c2-7a00-7000-8000-0000000000f1',
      juristicName: 'นิติบุคคลอาคารชุดตัวอย่าง',
      formedOn: '2027-03-01',
      warrantyGrantValidTo: '2028-09-30',
    },
  },
  'procurement.rfq.requested': {
    ...base,
    eventId: '0199f1c2-7a00-7000-8000-000000000006',
    type: 'procurement.rfq.requested',
    idempotencyKey: 'getproperty:rfq:rfq-77',
    sourcePlatform: 'getproperty',
    tenantId: '0199f1c2-7a00-7000-8000-0000000000e1',
    payload: {
      rfqRef: 'rfq-77',
      buildingId: '0199f1c2-7a00-7000-8000-0000000000b1',
      deliverTo: { name: 'หอพักตัวอย่าง', address: { province: 'นนทบุรี', postcode: '11000' } },
      neededBy: '2026-11-15',
      items: [{ description: 'ก๊อกน้ำอ่างล้างหน้า', quantity: '2', unit: 'pcs' }],
    },
  },
  'procurement.order.updated': {
    ...base,
    eventId: '0199f1c2-7a00-7000-8000-000000000007',
    type: 'procurement.order.updated',
    idempotencyKey: 'getpack:order:po-5:shipped',
    sourcePlatform: 'getpack',
    tenantId: null,
    payload: {
      rfqRef: 'rfq-77',
      orderRef: 'po-5',
      status: 'shipped',
      price: { subtotal: '700.00', vat: '49.00', total: '749.00', currency: 'THB' },
    },
  },
  'identity.party.linked': {
    ...base,
    eventId: '0199f1c2-7a00-7000-8000-000000000008',
    type: 'identity.party.linked',
    idempotencyKey: 'getbuild:party:p-1:line:Ufake0000000000000000000000000001',
    sourcePlatform: 'getbuild',
    tenantId: '0199f1c2-7a00-7000-8000-0000000000d1',
    payload: {
      partyRef: 'p-1',
      lineUserId: 'Ufake0000000000000000000000000001',
      linkedAt: '2026-10-16T12:00:00+07:00',
    },
  },
};
