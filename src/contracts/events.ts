import { z } from 'zod';

import {
  DecimalString,
  EncryptedPii,
  HttpsUrl,
  IsoDate,
  IsoDateTime,
  Money,
  PartyPayload,
  SourceRef,
  UnitTypeSchema,
  Uuid,
} from './common.js';
import { eventEnvelope } from './envelope.js';

/*
 * Payloads of the eight integration events of the blueprint "Integration contracts" table (D-153).
 * Direction is informative (both sides persist every event); the producer named first sets sourcePlatform.
 * Refs (`*Ref`) are ids in the source platform; getproperty keeps them in `source_ref` columns.
 */

const Address = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  subdistrict: z.string().optional(),
  district: z.string().optional(),
  province: z.string().optional(),
  postcode: z
    .string()
    .regex(/^\d{5}$/)
    .optional(),
  country: z.string().length(2).default('TH'),
});

// 1. building.handover.requested — getbuild → getproperty (common-area handover in getbuild M1 → D1 post-sale)
export const BuildingHandoverRequestedPayload = z.object({
  developerTenantRef: SourceRef,
  requestedHandoverAt: IsoDateTime,
  property: z.object({
    ref: SourceRef,
    code: z.string().min(1).max(50),
    name: z.string().min(1),
    address: Address,
  }),
  building: z.object({
    ref: SourceRef,
    code: z.string().min(1).max(50),
    name: z.string().min(1),
    type: z.enum(['apartment', 'condo', 'house_cluster', 'mixed_use']),
    floorsCount: z.number().int().min(0).optional(),
    registrationNo: z.string().optional(),
  }),
  floors: z.array(z.object({ ref: SourceRef, level: z.number().int(), name: z.string().min(1) })),
  units: z
    .array(
      z.object({
        ref: SourceRef,
        floorRef: SourceRef.optional(),
        unitNo: z.string().min(1).max(50),
        type: UnitTypeSchema,
        areaSqm: DecimalString.optional(),
        ownershipRatio: DecimalString.optional(),
        titleDeedNo: z.string().optional(),
      }),
    )
    .min(1),
  parties: z.array(PartyPayload),
  unitOwnerships: z.array(
    z.object({ unitRef: SourceRef, partyRef: SourceRef, sharePct: DecimalString, validFrom: IsoDate }),
  ),
  defects: z
    .array(
      z.object({
        ref: SourceRef,
        unitRef: SourceRef.optional(),
        category: z.string().min(1),
        status: z.enum(['open', 'in_progress', 'closed']),
        reportedAt: IsoDateTime,
        closedAt: IsoDateTime.optional(),
      }),
    )
    .default([]),
  warrantyTerms: z
    .array(
      z.object({
        scope: z.enum(['building', 'unit', 'asset_item']),
        ref: SourceRef,
        startsOn: IsoDate,
        endsOn: IsoDate,
        warrantorPartyRef: SourceRef.optional(),
      }),
    )
    .default([]),
  documents: z
    .array(
      z.object({
        ref: SourceRef,
        kind: z.enum(['as_built', 'floor_plan', 'certificate', 'warranty', 'contract', 'other']),
        title: z.string().optional(),
        url: HttpsUrl,
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .default([]),
  assetItems: z
    .array(
      z.object({
        ref: SourceRef,
        category: z.string().min(1),
        name: z.string().min(1),
        manufacturer: z.string().optional(),
        model: z.string().optional(),
        serial: z.string().optional(),
        unitRef: SourceRef.optional(),
        floorRef: SourceRef.optional(),
        installDate: IsoDate.optional(),
        warrantyUntil: IsoDate.optional(),
      }),
    )
    .default([]),
});
export const BuildingHandoverRequested = eventEnvelope(
  'building.handover.requested',
  BuildingHandoverRequestedPayload,
);

// 2. unit.transferred — getbuild → getproperty (transfer closed in getbuild M7 → ownership/occupancy; D2 invite)
export const UnitTransferredPayload = z.object({
  buildingRef: SourceRef,
  unitRef: SourceRef,
  buyer: PartyPayload,
  sharePct: DecimalString.default('100'),
  transferDate: IsoDate,
  rentalIntent: z.boolean(),
  warrantyStartsOn: IsoDate.optional(),
});
export const UnitTransferred = eventEnvelope('unit.transferred', UnitTransferredPayload);

// 3. warranty.defect.reported — getproperty → getbuild (A4 service request within warranty)
export const WarrantyDefectReportedPayload = z.object({
  serviceRequestId: Uuid,
  buildingRef: SourceRef,
  unitRef: SourceRef.optional(),
  assetItemRef: SourceRef.optional(),
  category: z.string().min(1),
  description: z.string().min(1).max(5000),
  photos: z.array(HttpsUrl).max(20).default([]),
  reportedAt: IsoDateTime,
  reporter: EncryptedPii,
});
export const WarrantyDefectReported = eventEnvelope(
  'warranty.defect.reported',
  WarrantyDefectReportedPayload,
);

// 4. warranty.defect.closed — getbuild → getproperty (close the service request, notify the resident)
export const WarrantyDefectClosedPayload = z.object({
  defectRef: SourceRef,
  serviceRequestId: Uuid,
  resolution: z.enum(['fixed', 'replaced', 'not_a_defect', 'out_of_warranty', 'duplicate']),
  resolutionNote: z.string().max(5000).optional(),
  closedAt: IsoDateTime,
  afterPhotos: z.array(HttpsUrl).max(20).default([]),
});
export const WarrantyDefectClosed = eventEnvelope('warranty.defect.closed', WarrantyDefectClosedPayload);

// 5. juristic.formed — getproperty → getbuild (D1 operator transfer; getbuild keeps only a warranty grant)
export const JuristicFormedPayload = z.object({
  buildingId: Uuid,
  buildingRef: SourceRef,
  juristicTenantId: Uuid,
  juristicName: z.string().min(1),
  registrationNo: z.string().optional(),
  formedOn: IsoDate,
  warrantyGrantValidTo: IsoDate.optional(),
});
export const JuristicFormed = eventEnvelope('juristic.formed', JuristicFormedPayload);

// 6. procurement.rfq.requested — getproperty → getpack (A4 parts / B3 maintenance → RFQ)
export const ProcurementRfqRequestedPayload = z.object({
  rfqRef: SourceRef,
  buildingId: Uuid,
  deliverTo: z.object({ name: z.string().min(1), address: Address, contact: EncryptedPii.optional() }),
  neededBy: IsoDate,
  items: z
    .array(
      z.object({
        sku: z.string().optional(),
        description: z.string().min(1),
        quantity: DecimalString,
        unit: z.string().min(1).max(20),
        spec: z.string().max(5000).optional(),
      }),
    )
    .min(1),
  workOrderId: Uuid.optional(),
  assetItemId: Uuid.optional(),
});
export const ProcurementRfqRequested = eventEnvelope(
  'procurement.rfq.requested',
  ProcurementRfqRequestedPayload,
);

// 7. procurement.order.updated — getpack → getproperty (cost into the work order / asset item)
export const ProcurementOrderUpdatedPayload = z.object({
  rfqRef: SourceRef,
  orderRef: SourceRef,
  status: z.enum(['quoted', 'ordered', 'shipped', 'delivered', 'cancelled']),
  price: z
    .object({ subtotal: Money, vat: Money, total: Money, currency: z.literal('THB').default('THB') })
    .optional(),
  proofOfDelivery: z.object({ url: HttpsUrl, deliveredAt: IsoDateTime }).optional(),
  workOrderId: Uuid.optional(),
});
export const ProcurementOrderUpdated = eventEnvelope(
  'procurement.order.updated',
  ProcurementOrderUpdatedPayload,
);

// 8. identity.party.linked — both ways (one LINE identity across getbuild LIFF and getproperty)
export const IdentityPartyLinkedPayload = z.object({
  partyRef: SourceRef,
  lineUserId: z.string().min(1).max(100),
  linkedAt: IsoDateTime,
  userRef: SourceRef.optional(),
});
export const IdentityPartyLinked = eventEnvelope('identity.party.linked', IdentityPartyLinkedPayload);

/** Every integration event: schema, producing platform and consumers (blueprint table). */
export const INTEGRATION_EVENTS = {
  'building.handover.requested': {
    schema: BuildingHandoverRequested,
    from: ['getbuild'],
    to: ['getproperty'],
  },
  'unit.transferred': { schema: UnitTransferred, from: ['getbuild'], to: ['getproperty'] },
  'warranty.defect.reported': { schema: WarrantyDefectReported, from: ['getproperty'], to: ['getbuild'] },
  'warranty.defect.closed': { schema: WarrantyDefectClosed, from: ['getbuild'], to: ['getproperty'] },
  'juristic.formed': { schema: JuristicFormed, from: ['getproperty'], to: ['getbuild'] },
  'procurement.rfq.requested': { schema: ProcurementRfqRequested, from: ['getproperty'], to: ['getpack'] },
  'procurement.order.updated': { schema: ProcurementOrderUpdated, from: ['getpack'], to: ['getproperty'] },
  'identity.party.linked': {
    schema: IdentityPartyLinked,
    from: ['getbuild', 'getproperty'],
    to: ['getbuild', 'getproperty'],
  },
} as const;

export type IntegrationEventType = keyof typeof INTEGRATION_EVENTS;
export const INTEGRATION_EVENT_TYPES = Object.keys(INTEGRATION_EVENTS) as IntegrationEventType[];

/** Discriminated union of every envelope (parse any incoming event with it). */
export const IntegrationEvent = z.discriminatedUnion('type', [
  BuildingHandoverRequested,
  UnitTransferred,
  WarrantyDefectReported,
  WarrantyDefectClosed,
  JuristicFormed,
  ProcurementRfqRequested,
  ProcurementOrderUpdated,
  IdentityPartyLinked,
]);
export type IntegrationEvent = z.infer<typeof IntegrationEvent>;
export type IntegrationEventOf<T extends IntegrationEventType> = Extract<IntegrationEvent, { type: T }>;
