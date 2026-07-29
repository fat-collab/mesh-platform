/**
 * MESH Platform — sample board data.
 *
 * Used by the Ops Cockpit when no authenticated Supabase session returns rows
 * (e.g. local dev without login), so the board is always demonstrable. Mirrors
 * the shape of `supabase/seed.sql`.
 */
import type { BoardOrder } from './board';
import type {
  AuditLogEntry,
  OEMSpecData,
  PartsLineItem,
  StructuralMaterial,
  SupplementPackage,
} from '@/components/ops/types';

export const MOCK_BOARD_ORDERS: BoardOrder[] = [
  {
    id: 'mock-a6f1',
    claim_number: 'APX-2026-0001',
    customer_name: 'Dana Whitfield',
    vehicle: '2021 Ford F-150',
    vin: '1FTFW1E80MFA10023',
    location: 'Apex — Downtown',
    stage: 'INTAKE',
    created_at: "2026-07-24T16:31:35.922Z",
    updated_at: "2026-07-24T16:31:35.922Z",
    hold_gate_active: false,
    risk_score: null,
    aluminum: true,
    assignedStaffName: 'Avery Nguyen',
  },
  {
    id: 'mock-a6f2',
    claim_number: 'APX-2026-0002',
    customer_name: 'Leo Marsh',
    vehicle: '2020 Honda Accord',
    vin: '1HGCV1F30LA204471',
    location: 'Apex — Downtown',
    stage: 'PDR_REPAIR',
    created_at: "2026-07-24T16:31:35.922Z",
    updated_at: "2026-07-24T16:31:35.922Z",
    hold_gate_active: false,
    risk_score: 0.42,
  },
  {
    id: 'mock-a6f3',
    claim_number: 'APX-2026-0003',
    customer_name: 'Priya Nair',
    vehicle: '2019 Tesla Model 3',
    vin: '5YJ3E1EA7KF318852',
    location: 'Apex — Airport',
    stage: 'HOLD_CARRIER',
    created_at: "2026-07-24T16:31:35.922Z",
    updated_at: "2026-07-24T16:31:35.922Z",
    hold_gate_active: true,
    risk_score: 0.71,
  },
  {
    id: 'mock-a6f4',
    claim_number: 'APX-2026-0004',
    customer_name: 'Sam Okoye',
    vehicle: '2021 Ford F-150',
    vin: '1FTFW1E85MFB67390',
    location: 'Apex — Airport',
    stage: 'HOLD_TOTAL_LOSS',
    created_at: "2026-07-24T16:31:35.922Z",
    updated_at: "2026-07-24T16:31:35.922Z",
    hold_gate_active: true,
    risk_score: 1.1481,
    aluminum: true,
  },
  {
    id: 'mock-a6f5',
    claim_number: 'APX-2026-0005',
    customer_name: 'Grace Lin',
    vehicle: '2020 Honda Accord',
    vin: '1HGCV1F34LA905513',
    location: 'Apex — Downtown',
    stage: 'QC_DELIVERY',
    created_at: "2026-07-24T16:31:35.922Z",
    updated_at: "2026-07-24T16:31:35.922Z",
    hold_gate_active: false,
    risk_score: null,
  },
  {
    id: 'mock-a6f6',
    claim_number: 'APX-2026-0006',
    customer_name: 'Ruth Delgado',
    vehicle: '2022 Subaru Outback',
    vin: '4S4BTGPD8N3241096',
    location: 'Apex — Downtown',
    stage: 'TEARDOWN',
    created_at: "2026-07-24T16:31:35.922Z",
    updated_at: "2026-07-24T16:31:35.922Z",
    hold_gate_active: false,
    risk_score: 0.55,
  },
  {
    id: 'mock-a6f7',
    claim_number: 'APX-2026-0007',
    customer_name: 'Toby Frost',
    vehicle: '2023 Rivian R1T',
    vin: '7FCTGAAA5PN078224',
    location: 'Apex — Airport',
    stage: 'ADAS_SUBLET',
    created_at: "2026-07-24T16:31:35.922Z",
    updated_at: "2026-07-24T16:31:35.922Z",
    hold_gate_active: false,
    risk_score: 0.9,
    aluminum: true,
  },
  {
    id: 'mock-b6f1',
    claim_number: 'BRG-2026-0001',
    customer_name: 'Hector Ruiz',
    vehicle: '2019 Toyota Camry',
    vin: '4T1B11HK9KU739160',
    location: 'Bridgeway — Main',
    stage: 'HOLD_PARTS',
    created_at: "2026-07-24T16:31:35.922Z",
    updated_at: "2026-07-24T16:31:35.922Z",
    hold_gate_active: true,
    risk_score: null,
  },
];

/**
 * Sample parts line items keyed by claim number (shared between live-Supabase
 * and sample orders). Demonstrates invoice capture and discrepancy handling.
 */
export const MOCK_PARTS_BY_CLAIM: Record<string, PartsLineItem[]> = {
  'APX-2026-0001': [
    {
      name: 'Rear quarter panel (LH)',
      status: 'RECEIVED',
      sourcingTier: 'OEM',
      leadTimeDays: 4,
      invoiceNumber: 'INV-88123',
      invoiceUrl: 'https://parts.example.com/invoices/INV-88123.pdf',
    },
    {
      name: 'LED headlight assembly (RH)',
      status: 'IN_TRANSIT',
      sourcingTier: 'AFTERMARKET',
      capaCertified: true,
      leadTimeDays: 6,
    },
    { name: 'Front bumper absorber', status: 'ORDERED', sourcingTier: 'LKQ', leadTimeDays: 9 },
  ],
  'APX-2026-0003': [
    {
      name: 'Front bumper cover',
      status: 'DISCREPANCY',
      sourcingTier: 'AFTERMARKET',
      capaCertified: false,
      leadTimeDays: 7,
      discrepancyReason: 'DAMAGED_IN_TRANSIT',
      discrepancyNotes: 'Deep gouge on lower valance, corner tab cracked.',
      returnRmaNumber: 'RMA-40551',
      replacementExpectedDate: '2026-08-03',
    },
    {
      name: 'Radiator support',
      status: 'RECEIVED',
      sourcingTier: 'OEM',
      leadTimeDays: 5,
      invoiceNumber: 'INV-88090',
    },
  ],
  'APX-2026-0004': [
    {
      name: 'Hood panel (aluminum)',
      status: 'DISCREPANCY',
      sourcingTier: 'OEM',
      leadTimeDays: 12,
      discrepancyReason: 'INCORRECT_FITMENT',
      discrepancyNotes: 'Hinge holes misaligned ~6mm; will not seat.',
      returnRmaNumber: 'RMA-40560',
      replacementExpectedDate: '2026-08-10',
    },
    { name: 'Grille assembly', status: 'NEEDED', sourcingTier: 'AFTERMARKET', capaCertified: true },
    { name: 'Windshield', status: 'ORDERED', sourcingTier: 'OEM', leadTimeDays: 8 },
  ],
  'BRG-2026-0001': [
    { name: 'Condenser', status: 'IN_TRANSIT', sourcingTier: 'LKQ', leadTimeDays: 3 },
    { name: 'AC compressor', status: 'ORDERED', sourcingTier: 'RECONDITIONED', leadTimeDays: 10 },
    {
      name: 'Fender liner (RH)',
      status: 'NEEDED',
      sourcingTier: 'AFTERMARKET',
      capaCertified: false,
    },
  ],
};

/**
 * Sample hold-gate activity for the Audit History view. Renders immediately
 * when hold_gate_logs is empty/unseeded; static timestamps yield deterministic
 * resolution-time analytics.
 */
export const MOCK_AUDIT_LOG: AuditLogEntry[] = [
  {
    id: 'log-0001',
    claimNumber: 'APX-2026-0001',
    vin: '1FTFW1E80MFA10023',
    category: 'Parts',
    operator: 'Dana Whitfield',
    action: 'RESOLVED',
    reason: 'Backorder cleared — quarter panel received and verified.',
    lockedAt: '2026-07-20T09:00:00.000Z',
    resolvedAt: '2026-07-22T14:30:00.000Z',
  },
  {
    id: 'log-0002',
    claimNumber: 'APX-2026-0003',
    vin: '5YJ3E1EA7KF318852',
    category: 'Insurance',
    operator: 'Priya Nair',
    action: 'RESOLVED',
    reason: 'Carrier supplement approved.',
    lockedAt: '2026-07-21T10:00:00.000Z',
    resolvedAt: '2026-07-21T16:00:00.000Z',
  },
  {
    id: 'log-0003',
    claimNumber: 'APX-2026-0006',
    vin: '4S4BTGPD8N3241096',
    category: 'Tech',
    operator: 'Marcus Webb (Manager)',
    action: 'OVERRIDDEN',
    reason: 'Manager override — job reassigned to available technician.',
    lockedAt: '2026-07-23T08:00:00.000Z',
    resolvedAt: '2026-07-23T12:00:00.000Z',
  },
  {
    id: 'log-0004',
    claimNumber: 'APX-2026-0007',
    vin: '7FCTGAAA5PN078224',
    category: 'Sublet',
    operator: 'Sam Okoye',
    action: 'RESOLVED',
    reason: 'ADAS calibration returned from sublet vendor.',
    lockedAt: '2026-07-19T13:00:00.000Z',
    resolvedAt: '2026-07-24T09:00:00.000Z',
  },
  {
    id: 'log-0005',
    claimNumber: 'BRG-2026-0001',
    vin: '4T1B11HK9KU739160',
    category: 'Parts',
    operator: 'Hector Ruiz',
    action: 'PLACED_ON_HOLD',
    reason: 'Awaiting condenser + compressor on backorder.',
    lockedAt: '2026-07-24T15:00:00.000Z',
    resolvedAt: null,
  },
  {
    id: 'log-0006',
    claimNumber: 'APX-2026-0004',
    vin: '1FTFW1E85MFB67390',
    category: 'Total Loss',
    operator: 'Elena Cross (Adjuster)',
    action: 'RESOLVED',
    reason: 'PDR rebuttal accepted — repair authorized over total-loss call.',
    lockedAt: '2026-07-18T11:00:00.000Z',
    resolvedAt: '2026-07-20T11:00:00.000Z',
  },
  {
    id: 'log-0007',
    claimNumber: 'APX-2026-0002',
    vin: '1HGCV1F30LA204471',
    category: 'Insurance',
    operator: 'Leo Marsh',
    action: 'PLACED_ON_HOLD',
    reason: 'Pending adjuster authorization on supplement #2.',
    lockedAt: '2026-07-24T12:00:00.000Z',
    resolvedAt: null,
  },
  {
    id: 'log-0008',
    claimNumber: 'APX-2026-0005',
    vin: '1HGCV1F34LA905513',
    category: 'Tech',
    operator: 'Grace Lin',
    action: 'RESOLVED',
    reason: 'Assigned technician returned from PTO.',
    lockedAt: '2026-07-22T07:30:00.000Z',
    resolvedAt: '2026-07-22T15:30:00.000Z',
  },
];

/**
 * OEM spec + structural repair-rule records, keyed by the last 8 of the VIN
 * (matching MOCK_BOARD_ORDERS). getOEMSpecsByVIN falls back to a deterministic
 * smart default for any unlisted VIN.
 */
const OEM_SPECS: Record<string, OEMSpecData> = {
  // 2021 Ford F-150 — military-grade aluminum body
  MFA10023: {
    vinLast8: 'MFA10023',
    trimPackage: 'XLT SuperCrew',
    paintCode: 'UM',
    paintName: 'Agate Black Metallic',
    bodyType: 'Pickup (aluminum)',
    structuralMaterial: 'Aluminum',
    oemScanRequired: true,
    structuralRules: [
      'Aluminum outer panels — no hot pulling or flame straightening allowed.',
      'Repairs must be performed in a dedicated, isolated aluminum work station.',
      'Structural joints require self-piercing rivets + adhesive (no MIG on box).',
      'Mandatory pre- and post-repair ADAS scan (fwd camera / radar).',
    ],
  },
  MFB67390: {
    vinLast8: 'MFB67390',
    trimPackage: 'Lariat SuperCrew',
    paintCode: 'HN',
    paintName: 'Oxford White',
    bodyType: 'Pickup (aluminum)',
    structuralMaterial: 'Aluminum',
    oemScanRequired: true,
    structuralRules: [
      'Aluminum outer panels — no hot pulling or flame straightening allowed.',
      'Dedicated aluminum tooling required to avoid galvanic contamination.',
      'Mandatory pre- and post-repair ADAS scan (fwd camera / radar).',
    ],
  },
  // 2019 Tesla Model 3 — mixed steel/aluminum + UHSS, high-voltage
  KF318852: {
    vinLast8: 'KF318852',
    trimPackage: 'Long Range AWD',
    paintCode: 'PBSB',
    paintName: 'Solid Black',
    bodyType: 'Sedan (EV)',
    structuralMaterial: 'Mixed / UHSS',
    oemScanRequired: true,
    structuralRules: [
      'De-energize / isolate the high-voltage battery before structural work.',
      'UHSS/boron members — cold replacement at factory joints only, no sectioning.',
      'No heat on structural aluminum castings (megacasting is non-repairable).',
      'Mandatory Autopilot camera + radar recalibration post-repair.',
    ],
  },
  // 2020 Honda Accord — UHSS body, Honda Sensing
  LA204471: {
    vinLast8: 'LA204471',
    trimPackage: 'Sport 1.5T',
    paintCode: 'NH-731P',
    paintName: 'Crystal Black Pearl',
    bodyType: 'Sedan',
    structuralMaterial: 'Mixed / UHSS',
    oemScanRequired: true,
    structuralRules: [
      'Ultra-High-Strength Steel (UHSS) B-pillar — cold replacement only.',
      'Do not section 1500 MPa hot-stamped members outside OEM cut zones.',
      'Mandatory Honda Sensing (front radar + camera) recalibration.',
    ],
  },
  LA905513: {
    vinLast8: 'LA905513',
    trimPackage: 'EX-L 1.5T',
    paintCode: 'R-569P',
    paintName: 'Radiant Red Metallic',
    bodyType: 'Sedan',
    structuralMaterial: 'Mixed / UHSS',
    oemScanRequired: true,
    structuralRules: [
      'Ultra-High-Strength Steel (UHSS) B-pillar — cold replacement only.',
      'Mandatory Honda Sensing (front radar + camera) recalibration.',
    ],
  },
  // 2022 Subaru Outback — ring-frame reinforcement, EyeSight
  N3241096: {
    vinLast8: 'N3241096',
    trimPackage: 'Onyx Edition XT',
    paintCode: '37J',
    paintName: 'Autumn Green Metallic',
    bodyType: 'Wagon / SUV',
    structuralMaterial: 'Mixed / UHSS',
    oemScanRequired: true,
    structuralRules: [
      'UHSS full-ring frame — replace at factory seams; no heat straightening.',
      'Restore structural foam fill on affected pillars.',
      'Mandatory EyeSight stereo-camera recalibration (dynamic + static).',
    ],
  },
  // 2023 Rivian R1T — aluminum spaceframe EV
  PN078224: {
    vinLast8: 'PN078224',
    trimPackage: 'Adventure Package',
    paintCode: 'LSG',
    paintName: 'Launch Green',
    bodyType: 'Pickup (EV)',
    structuralMaterial: 'Aluminum',
    oemScanRequired: true,
    structuralRules: [
      'Isolate the high-voltage battery/skateboard before any cutting.',
      'Aluminum spaceframe — no hot pulling; rivet-bond structural joints.',
      'Mandatory Driver+ ADAS sensor suite recalibration post-repair.',
    ],
  },
  // 2019 Toyota Camry — hot-stamped UHSS, TSS
  KU739160: {
    vinLast8: 'KU739160',
    trimPackage: 'SE',
    paintCode: '218',
    paintName: 'Midnight Black Metallic',
    bodyType: 'Sedan',
    structuralMaterial: 'Mixed / UHSS',
    oemScanRequired: true,
    structuralRules: [
      '1500 MPa hot-stamped UHSS — replace at factory seams, no sectioning.',
      'Apply OEM cavity wax / corrosion protection to repaired members.',
      'Mandatory Toyota Safety Sense (TSS) radar + camera calibration.',
    ],
  },
};

/** Deterministic fallback spec for VINs not in the OEM catalog. */
function smartDefaultSpec(vinLast8: string): OEMSpecData {
  const materials: StructuralMaterial[] = [
    'Steel',
    'Aluminum',
    'Mixed / UHSS',
    'Carbon Composite',
  ];
  const charSum = [...vinLast8].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const structuralMaterial = materials[charSum % materials.length];

  const rules = [
    'Perform manufacturer pre- and post-repair diagnostic (ADAS) scan.',
    'Follow current OEM position statements for all structural sectioning.',
  ];
  if (structuralMaterial === 'Aluminum') {
    rules.push('Aluminum panels — no hot pulling; use a dedicated work station.');
  } else if (structuralMaterial === 'Mixed / UHSS') {
    rules.push('UHSS/boron members — cold replacement at factory joints only.');
  } else if (structuralMaterial === 'Carbon Composite') {
    rules.push('Carbon composite — inspect for delamination; bond per OEM only.');
  }

  return {
    vinLast8,
    trimPackage: 'Base / Unlisted',
    paintCode: 'N/A',
    paintName: 'Refer to RO / build sheet',
    bodyType: 'Passenger Vehicle',
    structuralMaterial,
    oemScanRequired: true,
    structuralRules: rules,
  };
}

/** Looks up OEM specs by the last 8 of a VIN, with a smart default fallback. */
export function getOEMSpecsByVIN(vinLast8: string): OEMSpecData {
  const key = vinLast8.trim().toUpperCase();
  return OEM_SPECS[key] ?? smartDefaultSpec(key);
}

/**
 * Sample internal supplement packages keyed by claim number. Renders the
 * scoping panel immediately when the supplements store is empty/unseeded.
 */
export const MOCK_SUPPLEMENTS: Record<string, SupplementPackage[]> = {
  'APX-2026-0003': [
    {
      id: 'sup-0003-1',
      claimNumber: 'APX-2026-0003',
      status: 'SUBMITTED',
      createdAt: '2026-07-23T09:15:00.000Z',
      adjusterNotes: 'Submitted with teardown photos ref #TD-3391.',
      totalDelta: 809.5,
      items: [
        {
          id: 'sli-0003-1',
          claimNumber: 'APX-2026-0003',
          category: 'BODY',
          description: 'Hidden inner reinforcement damage — R&I + repair',
          itemType: 'LABOR',
          hoursOrQuantity: 4.5,
          unitRate: 62,
          total: 279.0,
          teardownDiscovered: true,
          justificationNotes:
            'Left rail buckling exposed after bumper R&I; not visible pre-teardown.',
        },
        {
          id: 'sli-0003-2',
          claimNumber: 'APX-2026-0003',
          category: 'FRAME',
          description: 'Left frame rail section (OEM)',
          itemType: 'PART',
          hoursOrQuantity: 1,
          unitRate: 388,
          total: 388.0,
          teardownDiscovered: true,
          justificationNotes: 'Rail deformation requires sectioning per OEM procedure.',
        },
        {
          id: 'sli-0003-3',
          claimNumber: 'APX-2026-0003',
          category: 'ADAS',
          description: 'Front radar recalibration (post-structural)',
          itemType: 'LABOR',
          hoursOrQuantity: 1.5,
          unitRate: 95,
          total: 142.5,
          teardownDiscovered: false,
          justificationNotes: 'Mandatory OEM calibration after structural repair.',
        },
      ],
    },
  ],
  'APX-2026-0004': [
    {
      id: 'sup-0004-1',
      claimNumber: 'APX-2026-0004',
      status: 'DRAFT',
      createdAt: '2026-07-24T14:00:00.000Z',
      adjusterNotes: '',
      totalDelta: 312.0,
      items: [
        {
          id: 'sli-0004-1',
          claimNumber: 'APX-2026-0004',
          category: 'FRAME',
          description: 'Apron / radiator support pull + measure',
          itemType: 'LABOR',
          hoursOrQuantity: 3,
          unitRate: 68,
          total: 204.0,
          teardownDiscovered: true,
          justificationNotes: 'Datum out of spec 8mm on 3D measure post-teardown.',
        },
        {
          id: 'sli-0004-2',
          claimNumber: 'APX-2026-0004',
          category: 'PAINT',
          description: 'Additional blend panel — adjacent quarter',
          itemType: 'MISC',
          hoursOrQuantity: 2,
          unitRate: 54,
          total: 108.0,
          teardownDiscovered: false,
          justificationNotes: 'Tri-coat color match requires blend into quarter panel.',
        },
      ],
    },
  ],
};
