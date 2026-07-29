/**
 * MESH — abstracted vision / OCR service (server-side).
 *
 * A single `VisionExtractor` interface backs the pipeline. Adapters:
 *   - GeminiExtractor: gemini-2.0-flash multimodal OCR (default, per CLAUDE.md).
 *   - MockExtractor: deterministic offline fallback used when GEMINI_API_KEY is
 *     absent, so local dev/testing runs instantly without external calls.
 * `visionService` selects the adapter at call time and degrades gracefully.
 *
 * Server-only (uses Buffer / File / the Gemini SDK). Clients POST images to
 * /api/v1/vision/ocr rather than importing this module.
 */
import {
  GEMINI_MODEL,
  GeminiConfigError,
  Type,
  getGeminiClient,
} from '@/lib/gemini';

export type DocType =
  | 'VIN'
  | 'INSURANCE'
  | 'SUPPLEMENT_EVIDENCE'
  | 'PDR_DENT_GRID'
  | 'TOTAL_LOSS_COMP_SHEET';

export interface ExtractResult {
  success: boolean;
  data: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  rawText?: string;
  provider?: string;
}

export interface VisionExtractor {
  extractDocument(file: Buffer | File, docType: DocType): Promise<ExtractResult>;
}

/* ---- helpers -------------------------------------------------------------- */

async function toInline(file: Buffer | File): Promise<{ base64: string; mime: string }> {
  if (typeof File !== 'undefined' && file instanceof File) {
    const buf = Buffer.from(await file.arrayBuffer());
    return { base64: buf.toString('base64'), mime: file.type || 'image/jpeg' };
  }
  return { base64: (file as Buffer).toString('base64'), mime: 'image/jpeg' };
}

function str(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
}

function normalize(docType: DocType, parsed: Record<string, unknown>): Record<string, unknown> {
  if (docType === 'VIN') {
    const vin = str(parsed.vin);
    const year = Number(parsed.year);
    return {
      vin,
      vinLast8: vin ? vin.slice(-8).toUpperCase() : null,
      year: Number.isFinite(year) && year > 1900 ? Math.round(year) : null,
      make: str(parsed.make),
      model: str(parsed.model),
    };
  }
  if (docType === 'SUPPLEMENT_EVIDENCE') {
    const conf = Number(parsed.confidence);
    return {
      category: (str(parsed.category) ?? 'OTHER').toUpperCase(),
      caption: str(parsed.caption) ?? '',
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
    };
  }
  if (docType === 'PDR_DENT_GRID') {
    const sb = (parsed.size_breakdown ?? {}) as Record<string, unknown>;
    const int = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    };
    const sev = (str(parsed.severity) ?? 'MEDIUM').toUpperCase();
    const rate = Number(parsed.recommended_matrix_rate);
    return {
      panel: str(parsed.panel) ?? 'PANEL',
      dentCountEstimate: int(parsed.dent_count_estimate),
      sizeBreakdown: {
        dime: int(sb.dime),
        nickel: int(sb.nickel),
        quarter: int(sb.quarter),
        halfDollar: int(sb.half_dollar),
      },
      severity: ['LOW', 'MEDIUM', 'HIGH', 'REPLACE'].includes(sev) ? sev : 'MEDIUM',
      recommendedMatrixRate: Number.isFinite(rate) && rate >= 0 ? Math.round(rate) : 0,
    };
  }
  if (docType === 'TOTAL_LOSS_COMP_SHEET') {
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
    };
    const rawComps = Array.isArray(parsed.comps) ? parsed.comps : [];
    const comps = rawComps.map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        vin: str(o.vin) ?? '',
        makeModel: str(o.make_model) ?? '',
        mileage: num(o.mileage),
        distance: str(o.distance) ?? '',
        adjustedPrice: num(o.adjusted_price),
      };
    });
    return {
      vehicleValuation: num(parsed.vehicle_valuation),
      comps,
    };
  }
  return {
    carrier: str(parsed.carrier),
    policyNumber: str(parsed.policy_number),
    claimNumber: str(parsed.claim_number),
    customerName: str(parsed.customer_name),
  };
}

/* ---- Gemini schemas + prompts --------------------------------------------- */

const VIN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    vin: { type: Type.STRING, description: 'Full 17-char VIN if legible, else empty.' },
    year: { type: Type.INTEGER, description: 'Model year if derivable, else 0.' },
    make: { type: Type.STRING, description: 'Make if legible, else empty.' },
    model: { type: Type.STRING, description: 'Model if legible, else empty.' },
  },
  required: ['vin', 'year', 'make', 'model'],
} as const;

const INSURANCE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    carrier: { type: Type.STRING, description: 'Insurance carrier / company name.' },
    policy_number: { type: Type.STRING, description: 'Policy number.' },
    claim_number: { type: Type.STRING, description: 'Claim number if present, else empty.' },
    customer_name: { type: Type.STRING, description: 'Named insured, else empty.' },
  },
  required: ['carrier', 'policy_number', 'claim_number', 'customer_name'],
} as const;

const EVIDENCE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    category: {
      type: Type.STRING,
      description:
        'One of BROKEN_CLIP, FASTENER, TRIM_MOLDING, ALUMINUM_PANEL, PANEL, GLASS, LAMP, or OTHER.',
    },
    caption: {
      type: Type.STRING,
      description:
        'Concise adjuster-ready caption describing the damaged part/hardware and why replacement is warranted.',
    },
    confidence: { type: Type.NUMBER, description: 'Confidence 0.0–1.0.' },
  },
  required: ['category', 'caption', 'confidence'],
} as const;

const PDR_GRID_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    panel: { type: Type.STRING, description: 'Panel identifier, e.g. HOOD, ROOF, L-QUARTER.' },
    dent_count_estimate: { type: Type.INTEGER, description: 'Total distinct dents from grid distortion.' },
    size_breakdown: {
      type: Type.OBJECT,
      description: 'Dent counts by coin-size category.',
      properties: {
        dime: { type: Type.INTEGER },
        nickel: { type: Type.INTEGER },
        quarter: { type: Type.INTEGER },
        half_dollar: { type: Type.INTEGER },
      },
      required: ['dime', 'nickel', 'quarter', 'half_dollar'],
    },
    severity: { type: Type.STRING, description: 'One of LOW, MEDIUM, HIGH, REPLACE.' },
    recommended_matrix_rate: {
      type: Type.NUMBER,
      description: 'Recommended PDR matrix labor rate (USD) for this panel.',
    },
  },
  required: ['panel', 'dent_count_estimate', 'size_breakdown', 'severity', 'recommended_matrix_rate'],
} as const;

const COMP_SHEET_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    vehicle_valuation: {
      type: Type.NUMBER,
      description: 'The carrier’s determined actual cash value (ACV) for the loss vehicle, USD.',
    },
    comps: {
      type: Type.ARRAY,
      description: 'Comparable vehicles listed on the valuation report.',
      items: {
        type: Type.OBJECT,
        properties: {
          vin: { type: Type.STRING, description: 'Comparable VIN, else empty.' },
          make_model: { type: Type.STRING, description: 'Year / make / model / trim.' },
          mileage: { type: Type.INTEGER, description: 'Odometer, else 0.' },
          distance: { type: Type.STRING, description: 'Distance from loss location, e.g. "42 mi".' },
          adjusted_price: { type: Type.NUMBER, description: 'Adjusted comparable price, USD.' },
        },
        required: ['vin', 'make_model', 'mileage', 'distance', 'adjusted_price'],
      },
    },
  },
  required: ['vehicle_valuation', 'comps'],
} as const;

const PROMPT: Record<DocType, string> = {
  VIN: 'Read this VIN plate / label photo. Extract the VIN and any printed year, make, and model. Only report characters you can actually read; leave a field empty/0 if not legible.',
  INSURANCE:
    'Read this auto insurance card photo. Extract the carrier name, policy number, claim number (if any), and named insured. Leave a field empty if not legible.',
  SUPPLEMENT_EVIDENCE:
    'You are a collision supplement estimator. Analyze this photo of a damaged part or hardware. Classify it (broken clip, fastener, trim/molding, aluminum panel, panel, glass, lamp, etc.) and write a concise, carrier-ready caption describing the damage and why replacement is warranted. Report a confidence 0.0–1.0.',
  PDR_DENT_GRID:
    'You are a master PDR estimator reading a reflection-grid / light-board photo of one vehicle panel. Where the metal is dented the reflected grid lines bend or break. Identify the panel, estimate the total dent count, break dents down by coin size (dime, nickel, quarter, half-dollar), rate overall severity (LOW/MEDIUM/HIGH, or REPLACE if beyond PDR), and recommend a PDR matrix labor rate in USD for the panel.',
  TOTAL_LOSS_COMP_SHEET:
    'You are auditing an auto insurance total-loss valuation report. Extract the carrier’s determined vehicle valuation (ACV) and every comparable vehicle listed, with VIN, year/make/model/trim, mileage, distance from the loss location, and adjusted price. Only report values actually printed.',
};

/* ---- adapters ------------------------------------------------------------- */

export const geminiExtractor: VisionExtractor = {
  async extractDocument(file, docType) {
    const { base64, mime } = await toInline(file);
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mime, data: base64 } },
            { text: PROMPT[docType] },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema:
          docType === 'VIN'
            ? VIN_SCHEMA
            : docType === 'SUPPLEMENT_EVIDENCE'
              ? EVIDENCE_SCHEMA
              : docType === 'PDR_DENT_GRID'
                ? PDR_GRID_SCHEMA
                : docType === 'TOTAL_LOSS_COMP_SHEET'
                  ? COMP_SHEET_SCHEMA
                  : INSURANCE_SCHEMA,
        temperature: 0.1,
      },
    });

    const rawText = response.text;
    if (!rawText) return { success: false, data: {}, provider: 'gemini' };

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return { success: false, data: {}, rawText, provider: 'gemini' };
    }
    return { success: true, data: normalize(docType, parsed), rawText, provider: 'gemini' };
  },
};

/** Deterministic offline fallback — stable sample data, no external call. */
export const mockExtractor: VisionExtractor = {
  async extractDocument(_file, docType) {
    if (docType === 'VIN') {
      return {
        success: true,
        provider: 'mock',
        rawText: '1HGCV1F30LA204471 2021 HONDA ACCORD',
        data: {
          vin: '1HGCV1F30LA204471',
          vinLast8: 'LA204471',
          year: 2021,
          make: 'Honda',
          model: 'Accord',
        },
      };
    }
    if (docType === 'SUPPLEMENT_EVIDENCE') {
      return {
        success: true,
        provider: 'mock',
        rawText: 'BROKEN_CLIP cracked bumper retainer',
        data: {
          category: 'BROKEN_CLIP',
          caption:
            'Cracked bumper retainer clip — one-time-use hardware, replacement required.',
          confidence: 0.82,
        },
      };
    }
    if (docType === 'PDR_DENT_GRID') {
      return {
        success: true,
        provider: 'mock',
        rawText: 'HOOD 24 dents MEDIUM',
        data: {
          panel: 'HOOD',
          dentCountEstimate: 24,
          sizeBreakdown: { dime: 14, nickel: 7, quarter: 2, halfDollar: 1 },
          severity: 'MEDIUM',
          recommendedMatrixRate: 750,
        },
      };
    }
    if (docType === 'TOTAL_LOSS_COMP_SHEET') {
      return {
        success: true,
        provider: 'mock',
        rawText: 'ACV 18450 · 3 comps',
        data: {
          vehicleValuation: 18450,
          comps: [
            { vin: '1FTFW1E8XMFA22119', makeModel: '2021 Ford F-150 XLT', mileage: 41200, distance: '42 mi', adjustedPrice: 19750 },
            { vin: '1FTFW1E85MFB03388', makeModel: '2021 Ford F-150 XLT', mileage: 38900, distance: '88 mi', adjustedPrice: 20100 },
            { vin: '1FTFW1E80MFC55210', makeModel: '2021 Ford F-150 Lariat', mileage: 52300, distance: '150 mi', adjustedPrice: 17800 },
          ],
        },
      };
    }
    return {
      success: true,
      provider: 'mock',
      rawText: 'STATE FARM · POLICY TX-0098-44710 · CLAIM SF-771204 · DANA WHITFIELD',
      data: {
        carrier: 'State Farm',
        policyNumber: 'TX-0098-44710',
        claimNumber: 'SF-771204',
        customerName: 'Dana Whitfield',
      },
    };
  },
};

/* ---- composite service ---------------------------------------------------- */

/**
 * Selects Gemini when GEMINI_API_KEY is configured, else the deterministic
 * mock. On a Gemini config error it falls back to the mock; on other upstream
 * errors it returns a failed result the caller can surface as manual entry.
 */
export const visionService: VisionExtractor = {
  async extractDocument(file, docType) {
    if (!process.env.GEMINI_API_KEY) {
      return mockExtractor.extractDocument(file, docType);
    }
    try {
      return await geminiExtractor.extractDocument(file, docType);
    } catch (err) {
      if (err instanceof GeminiConfigError) {
        return mockExtractor.extractDocument(file, docType);
      }
      return {
        success: false,
        data: {},
        rawText: err instanceof Error ? err.message : 'Vision request failed.',
        provider: 'gemini',
      };
    }
  },
};
