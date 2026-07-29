import { NextResponse } from 'next/server';

interface RebuttalRequest {
  repairOrderId: string;
  claimNumber: string;
  insurerName: string;
  disputedLineItems: {
    description: string;
    deniedAmount: number;
    reason: string;
  }[];
  stateJurisdiction: string;
}

export async function POST(req: Request) {
  try {
    const body: RebuttalRequest = await req.json();
    const { repairOrderId, claimNumber, insurerName, disputedLineItems, stateJurisdiction } = body;

    if (!repairOrderId || !claimNumber || !insurerName) {
      return NextResponse.json({ error: 'Missing required claim parameters.' }, { status: 400 });
    }

    const isTexas = stateJurisdiction === 'TX' || !stateJurisdiction;
    const totalDisputed = disputedLineItems.reduce((acc, item) => acc + item.deniedAmount, 0);

    const federalStatutes = [
      "1. Magnuson-Moss Warranty Act (15 U.S.C. Section 2301) — Prohibition against forced aftermarket/salvage parts substitution compromising OEM structural integrity and factory warranties.",
      "2. FTC Act Section 5 — Unfair methods of competition and arbitrary labor-rate caps/refusal to pay mandatory OEM scan/calibration procedures."
    ];

    const stateStatutes = isTexas ? [
      "1. Texas Insurance Code Chapter 542 (Prompt Payment of Claims Act) — Notice of statutory 18% annual interest penalty plus attorney fees for wrongful claim delays/short-pays.",
      "2. Texas Insurance Code Chapter 1813 / SB 458 — Formal invocation of independent appraisal rights for unresolved material variances."
    ] : [`State-specific compliance framework loaded for jurisdiction: ${stateJurisdiction}`];

    const rebuttalLetterContent = `
[FORMAL DEMAND FOR SUPPLEMENT SETTLEMENT & STATUTORY NOTICE]

TO: Claims Adjustment Department, ${insurerName}
RE: Claim Number: ${claimNumber} | Repair Order: #${repairOrderId}
TOTAL DISPUTED VARIANCE: $${totalDisputed.toFixed(2)}

NOTICE OF REGULATORY & STATUTORY EXPOSURE:
This correspondence serves as formal notice that your carrier's partial approval/rejection of submitted supplement line items violates established federal consumer protection standards and state insurance codes.

I. APPLICABLE FEDERAL STATUTORY MANDATES:
${federalStatutes.join('\n')}

II. JURISDICTIONAL STATUTORY FRAMEWORK (${stateJurisdiction}):
${stateStatutes.join('\n')}

DISPUTED LINE ITEM SCHEDULE:
${disputedLineItems.map((item, i) => `[${i + 1}] ${item.description} | Denied: $${item.deniedAmount.toFixed(2)} | Reason Given: "${item.reason}"`).join('\n')}

DEMAND FOR REMEDIATION:
Remit full payment for the disputed balance within five (5) business days of receipt of this notice to avoid immediate escalation to state insurance commissioner review, statutory interest accrual, and formal appraisal demand.
    `.trim();

    return NextResponse.json({
      success: true,
      data: {
        repairOrderId,
        claimNumber,
        totalDisputed,
        jurisdiction: stateJurisdiction || 'TX',
        rebuttalText: rebuttalLetterContent,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error during rebuttal generation.' }, { status: 500 });
  }
}
