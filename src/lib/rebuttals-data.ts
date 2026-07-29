/**
 * MESH — Adjuster Accountability & Rebuttal Hub data.
 *
 * A lean, static reference of carrier tactics paired with regulatory
 * counter-punches, statutory citations, and ready-to-paste notice snippets.
 * Not legal advice — verify current statute/policy language before sending.
 */

export type RebuttalCategory =
  | 'PROMPT_PAYMENT'
  | 'TOTAL_LOSS'
  | 'PDR_MATRIX'
  | 'OEM_SAFETY';

export interface RebuttalItem {
  id: string;
  category: RebuttalCategory;
  title: string;
  carrierExcuse: string;
  tacticalCounterPunch: string;
  statutoryCitation: string;
  templateSnippet: string;
}

export const REBUTTAL_CATEGORY_LABEL: Record<RebuttalCategory, string> = {
  PROMPT_PAYMENT: 'Prompt Payment',
  TOTAL_LOSS: 'Total Loss',
  PDR_MATRIX: 'PDR Matrix',
  OEM_SAFETY: 'OEM Parts',
};

export const REBUTTAL_CATEGORIES: readonly RebuttalCategory[] = [
  'PROMPT_PAYMENT',
  'TOTAL_LOSS',
  'PDR_MATRIX',
  'OEM_SAFETY',
];

export const REBUTTALS: RebuttalItem[] = [
  // --- Prompt Payment (Tex. Ins. Code Ch. 542) --------------------------------
  {
    id: 'pp-15day-review',
    category: 'PROMPT_PAYMENT',
    title: '15-Day Acknowledgment & Investigation',
    carrierExcuse:
      '“We’re still reviewing the claim / haven’t gotten to it yet.” Weeks pass with no acknowledgment or requested items list.',
    tacticalCounterPunch:
      'The clock is statutory, not discretionary. Within 15 days of receiving notice of the claim the insurer MUST acknowledge, commence investigation, and request all items it reasonably needs. Put the receipt date on the record and demand the item list in writing.',
    statutoryCitation: 'Tex. Ins. Code § 542.055',
    templateSnippet:
      'Per Tex. Ins. Code § 542.055, your acknowledgment of and commencement of investigation into this claim, along with any request for items reasonably required, were due within 15 days of your receipt of notice of claim on [DATE]. Please confirm receipt and provide the complete list of items required to complete your review no later than [DATE].',
  },
  {
    id: 'pp-5day-payout',
    category: 'PROMPT_PAYMENT',
    title: '5-Day Payout After Acceptance',
    carrierExcuse:
      '“Payment is approved — it’s just in processing / check is in the mail” for weeks after the accepted estimate.',
    tacticalCounterPunch:
      'Once you notify that the claim (or supplement) will be paid, payment is due within 5 business days. Document the acceptance date; each business day past it accrues exposure.',
    statutoryCitation: 'Tex. Ins. Code § 542.057',
    templateSnippet:
      'Your office notified acceptance of this claim/supplement on [DATE]. Under Tex. Ins. Code § 542.057, payment is due within five (5) business days of that notice. Absent payment or a documented statutory basis for delay by [DATE], we will treat this as a delayed claim under § 542.058.',
  },
  {
    id: 'pp-60day-18pct',
    category: 'PROMPT_PAYMENT',
    title: '60-Day Delay → 18% Penalty + Fees',
    carrierExcuse:
      '“These things take time.” The claim drifts past 60 days with no payment and no statutory basis for extension.',
    tacticalCounterPunch:
      'This is the penalty trap. An insurer that delays payment beyond the statutory deadline is liable for the amount of the claim PLUS 18% per annum as damages AND reasonable attorney’s fees. Name the exposure explicitly — it changes the math on “slow-walking.”',
    statutoryCitation: 'Tex. Ins. Code §§ 542.058, 542.060',
    templateSnippet:
      'Payment on this claim has been delayed beyond the period permitted by Tex. Ins. Code Ch. 542. Under §§ 542.058 and 542.060, the insurer is liable for the amount of the claim, plus interest at 18% per annum as damages, plus reasonable attorney’s fees. Please remit payment in full by [DATE] to avoid these statutory damages.',
  },

  // --- Total Loss -------------------------------------------------------------
  {
    id: 'tl-comp-manipulation',
    category: 'TOTAL_LOSS',
    title: 'Comparable (Comp) Valuation Manipulation',
    carrierExcuse:
      '“Our valuation report is final.” ACV is suppressed with distant, dissimilar, or “typical negotiation”–reduced comparables and undocumented condition deductions.',
    tacticalCounterPunch:
      'Demand the itemized valuation. Texas total-loss rules require ACV built from truly comparable vehicles with documented, itemized adjustments. Challenge “typical negotiation” haircuts, mileage/option mismatches, and comps outside the local market.',
    statutoryCitation: '28 Tex. Admin. Code §§ 5.501–5.502',
    templateSnippet:
      'Please provide the complete, itemized total-loss valuation, including every comparable used and each condition/mileage/option adjustment. Under 28 TAC §§ 5.501–5.502, actual cash value must be supported by genuinely comparable vehicles with documented adjustments. We dispute the current valuation and request correction of the noted comparables and deductions.',
  },
  {
    id: 'tl-appraisal-clause',
    category: 'TOTAL_LOSS',
    title: 'Appraisal Clause Invocation',
    carrierExcuse:
      '“That’s our final number on ACV.” The carrier refuses to move despite documented higher market value.',
    tacticalCounterPunch:
      'Invoke the policy’s appraisal clause. It compels each side to name a competent, independent appraiser; disagreements go to an umpire. It removes the adjuster’s unilateral control of the number.',
    statutoryCitation: 'Policy Appraisal Provision (standard auto policy)',
    templateSnippet:
      'The insured hereby invokes the appraisal provision of the policy as to the amount of loss / actual cash value. Please provide your appraiser’s name and contact information within [X] days so the appraisers may select a competent, disinterested umpire as provided by the policy.',
  },

  {
    id: 'tl-demand-comp-vins',
    category: 'TOTAL_LOSS',
    title: 'Demand Comparable VINs & Source Listings',
    carrierExcuse:
      '“These are comparable vehicles” — but the valuation lists no VINs, no sources, and no way to verify the comps exist or actually match.',
    tacticalCounterPunch:
      'A comparable you can’t verify isn’t a comparable. Demand the VIN, dealer/source, listing date, odometer, trim, and equipment for every comp used, then cross-check each against the loss vehicle. Undocumented comps must be struck from the average.',
    statutoryCitation: '28 Tex. Admin. Code § 5.501 (documented comparables)',
    templateSnippet:
      'For each comparable vehicle used in the valuation, please provide the full VIN, dealer/source, listing date, odometer, trim, and optional equipment, with the listing reference. Under 28 TAC § 5.501, comparables must be documented; any comparable that cannot be independently verified must be removed from the ACV average.',
  },
  {
    id: 'tl-mileage-adjustment',
    category: 'TOTAL_LOSS',
    title: 'Mileage Adjustment (Lower Miles = Higher ACV)',
    carrierExcuse:
      'The valuation applies a flat or missing mileage adjustment, ignoring that the loss vehicle has lower mileage than the comps used.',
    tacticalCounterPunch:
      'Mileage must be adjusted per comparable to the loss vehicle’s actual odometer on a defensible per-mile basis. A lower-mile loss vehicle is worth MORE — demand the per-comp math and the correction where higher-mile comps were not adjusted upward.',
    statutoryCitation: '28 Tex. Admin. Code § 5.501 (itemized adjustments)',
    templateSnippet:
      'The loss vehicle’s odometer is [MILES]. Please provide the mileage adjustment applied to each comparable, including the per-mile basis used, and correct any comparable whose higher mileage was not adjusted upward to the loss vehicle’s actual mileage per 28 TAC § 5.501.',
  },
  {
    id: 'tl-condition-options',
    category: 'TOTAL_LOSS',
    title: 'Undocumented Condition & Options Deductions',
    carrierExcuse:
      '“Condition” deductions and trim/option mismatches quietly suppress ACV with no supporting documentation.',
    tacticalCounterPunch:
      'Every condition deduction must be itemized and supported; option and trim differences must be added back. Package content (leather, tow, tech, drivetrain) materially moves value — make each adjustment show its work.',
    statutoryCitation: '28 Tex. Admin. Code §§ 5.501–5.502',
    templateSnippet:
      'Please itemize and document each condition-based deduction applied to the loss vehicle’s value, and confirm that optional equipment and trim present on the loss vehicle (e.g., [OPTIONS]) were reflected as positive adjustments against each comparable, as required by 28 TAC §§ 5.501–5.502.',
  },

  // --- PDR Matrix -------------------------------------------------------------
  {
    id: 'pdr-edge-crease',
    category: 'PDR_MATRIX',
    title: 'Edge & Crease Dents Forced Into Matrix',
    carrierExcuse:
      '“The PDR matrix caps this panel.” Flat matrix pricing is applied to dents on panel edges, body lines, and creases.',
    tacticalCounterPunch:
      'PDR matrices explicitly assume accessible, round, non-edge, non-crease dents. Edge dents, creased/stretched metal, body-line dents, and braced areas fall OUTSIDE matrix and require line-time uplift or conventional repair. Document location per panel with a light board.',
    statutoryCitation: 'PDR matrix scope / industry standard (non-statutory)',
    templateSnippet:
      'The PDR matrix applied here is expressly limited to accessible, non-edge, non-crease damage. This estimate includes edge, body-line, and creased/stretched dents that fall outside matrix parameters. Please approve conventional repair or line-time uplift for the itemized out-of-matrix damage documented in the attached light-board photos.',
  },
  {
    id: 'pdr-density-access',
    category: 'PDR_MATRIX',
    title: 'Dent Density & Access Downgrade',
    carrierExcuse:
      '“Matrix tier already covers the whole car.” High-density panels and glue-pull/R&I access are ignored.',
    tacticalCounterPunch:
      'Matrix tiers assume standard access and typical density. Heavy density, aluminum panels, and dents requiring R&I or glued access exceed the tier. Provide a panel-by-panel count and note where access is not standard.',
    statutoryCitation: 'PDR matrix scope / industry standard (non-statutory)',
    templateSnippet:
      'The matrix tier applied assumes standard access and typical dent density. The attached panel-by-panel documentation shows density and access conditions (R&I / glue-pull / aluminum) exceeding tier assumptions. Please approve the itemized uplift and R&I labor required to complete a proper repair.',
  },

  // --- OEM Parts & Safety -----------------------------------------------------
  {
    id: 'oem-one-time-fasteners',
    category: 'OEM_SAFETY',
    title: 'One-Time-Use Fastener Denial',
    carrierExcuse:
      '“Reuse the bolts / clips.” R&I hardware, one-time-use bolts, and clips are struck from the estimate.',
    tacticalCounterPunch:
      'OEM repair procedures mandate replacement of one-time-use (TTY) fasteners — suspension, subframe, airbag, and structural bolts are not reusable. Reuse deviates from OEM procedure and creates liability. Attach the specific OEM procedure page.',
    statutoryCitation: 'OEM repair procedure / position statement; cf. Seebachan v. John Eagle (TX)',
    templateSnippet:
      'The struck fasteners are OEM-designated one-time-use / torque-to-yield hardware whose replacement is required by the manufacturer’s repair procedure (attached). Reuse deviates from OEM procedure and compromises occupant safety. Please approve replacement of the itemized one-time-use fasteners.',
  },
  {
    id: 'oem-pre-post-scan',
    category: 'OEM_SAFETY',
    title: 'Pre-/Post-Repair Scan Denial',
    carrierExcuse:
      '“Scans aren’t necessary / not covered.” Diagnostic pre- and post-repair scans and calibrations are denied.',
    tacticalCounterPunch:
      'Nearly all OEMs’ position statements require pre- and post-repair scans, and ADAS components require calibration after affected repairs. Skipping them leaves DTCs and uncalibrated safety systems — cite the OEM position statement for the make.',
    statutoryCitation: 'OEM position statement; I-CAR guidance',
    templateSnippet:
      'The manufacturer’s position statement (attached) requires pre- and post-repair diagnostic scanning and calibration of affected ADAS components for this vehicle. These operations are necessary to restore the vehicle to pre-loss, OEM-specified condition. Please approve the itemized scan and calibration operations.',
  },
];
