/**
 * MESH Platform — Database type definitions.
 *
 * Hand-authored to mirror `supabase/migrations/20260101000000_init_mesh.sql`.
 * Shape matches the output of `supabase gen types typescript` so it can be
 * regenerated later with:
 *   supabase gen types typescript --linked > src/lib/database.types.ts
 *
 * Trigger-derived / defaulted columns are optional in `Insert`:
 *   - repair_orders.hold_gate_active        (derived from stage)
 *   - total_loss_audits.risk_score          (computed)
 *   - payout_splits.net_payout              (computed)
 *   - <ro-child>.organization_id            (derived from parent RO)
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = 'TECH' | 'MANAGER' | 'ADJUSTER' | 'CUSTOMER' | 'EXECUTIVE';

export type RoStage =
  | 'INTAKE'
  | 'TEARDOWN'
  | 'HOLD_CARRIER'
  | 'PDR_REPAIR'
  | 'HOLD_PARTS'
  | 'ADAS_SUBLET'
  | 'HOLD_TOTAL_LOSS'
  | 'QC_DELIVERY';

export type HoldGateType =
  | 'CARRIER_SUPPLEMENT'
  | 'PARTS_BACKORDER'
  | 'TOTAL_LOSS_REBUTTAL';

export type PayoutStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PAID'
  | 'FAILED'
  | 'REVERSED';

export type PayoutSplitRole = 'PDR_LEAD' | 'SALES' | 'HOUSE';

/** Stages whose repair-order cards are locked hold gates (business rule C). */
export const HOLD_STAGES: readonly RoStage[] = [
  'HOLD_CARRIER',
  'HOLD_PARTS',
  'HOLD_TOTAL_LOSS',
];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      locations: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          address: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'locations_organization_id_fkey';
            columns: ['organization_id'];
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          id: string;
          auth_user_id: string;
          organization_id: string;
          role: UserRole;
          full_name: string | null;
          email: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id: string;
          organization_id: string;
          role?: UserRole;
          full_name?: string | null;
          email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string;
          organization_id?: string;
          role?: UserRole;
          full_name?: string | null;
          email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'users_organization_id_fkey';
            columns: ['organization_id'];
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      vehicles: {
        Row: {
          id: string;
          organization_id: string;
          vin: string | null;
          make: string | null;
          model: string | null;
          year: number | null;
          paint_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          vin?: string | null;
          make?: string | null;
          model?: string | null;
          year?: number | null;
          paint_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          vin?: string | null;
          make?: string | null;
          model?: string | null;
          year?: number | null;
          paint_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'vehicles_organization_id_fkey';
            columns: ['organization_id'];
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      repair_orders: {
        Row: {
          id: string;
          organization_id: string;
          location_id: string | null;
          vehicle_id: string | null;
          customer_name: string | null;
          claim_number: string | null;
          stage: RoStage;
          hold_gate_active: boolean;
          target_delivery_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          location_id?: string | null;
          vehicle_id?: string | null;
          customer_name?: string | null;
          claim_number?: string | null;
          stage?: RoStage;
          hold_gate_active?: boolean;
          target_delivery_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          location_id?: string | null;
          vehicle_id?: string | null;
          customer_name?: string | null;
          claim_number?: string | null;
          stage?: RoStage;
          hold_gate_active?: boolean;
          target_delivery_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'repair_orders_organization_id_fkey';
            columns: ['organization_id'];
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'repair_orders_location_id_fkey';
            columns: ['location_id'];
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'repair_orders_vehicle_id_fkey';
            columns: ['vehicle_id'];
            referencedRelation: 'vehicles';
            referencedColumns: ['id'];
          },
        ];
      };
      total_loss_audits: {
        Row: {
          id: string;
          ro_id: string;
          organization_id: string;
          acv_amount: number | null;
          conventional_estimate: number | null;
          pdr_estimate: number | null;
          risk_score: number | null;
          state_threshold_pct: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          ro_id: string;
          organization_id?: string;
          acv_amount?: number | null;
          conventional_estimate?: number | null;
          pdr_estimate?: number | null;
          risk_score?: number | null;
          state_threshold_pct?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          ro_id?: string;
          organization_id?: string;
          acv_amount?: number | null;
          conventional_estimate?: number | null;
          pdr_estimate?: number | null;
          risk_score?: number | null;
          state_threshold_pct?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'total_loss_audits_ro_id_fkey';
            columns: ['ro_id'];
            referencedRelation: 'repair_orders';
            referencedColumns: ['id'];
          },
        ];
      };
      hold_gate_logs: {
        Row: {
          id: string;
          ro_id: string;
          organization_id: string;
          gate_type: HoldGateType;
          locked_at: string;
          unlocked_at: string | null;
          resolved_by: string | null;
          resolution_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          ro_id: string;
          organization_id?: string;
          gate_type: HoldGateType;
          locked_at?: string;
          unlocked_at?: string | null;
          resolved_by?: string | null;
          resolution_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          ro_id?: string;
          organization_id?: string;
          gate_type?: HoldGateType;
          locked_at?: string;
          unlocked_at?: string | null;
          resolved_by?: string | null;
          resolution_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'hold_gate_logs_ro_id_fkey';
            columns: ['ro_id'];
            referencedRelation: 'repair_orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'hold_gate_logs_resolved_by_fkey';
            columns: ['resolved_by'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      proof_of_payments: {
        Row: {
          id: string;
          ro_id: string;
          organization_id: string;
          check_amount: number | null;
          check_image_url: string | null;
          ocr_verified_flag: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          ro_id: string;
          organization_id?: string;
          check_amount?: number | null;
          check_image_url?: string | null;
          ocr_verified_flag?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          ro_id?: string;
          organization_id?: string;
          check_amount?: number | null;
          check_image_url?: string | null;
          ocr_verified_flag?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'proof_of_payments_ro_id_fkey';
            columns: ['ro_id'];
            referencedRelation: 'repair_orders';
            referencedColumns: ['id'];
          },
        ];
      };
      payout_splits: {
        Row: {
          id: string;
          ro_id: string;
          organization_id: string;
          tech_user_id: string | null;
          split_role: PayoutSplitRole | null;
          gross_amount: number;
          tech_split_pct: number;
          net_payout: number | null;
          stripe_transfer_id: string | null;
          status: PayoutStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          ro_id: string;
          organization_id?: string;
          tech_user_id?: string | null;
          split_role?: PayoutSplitRole | null;
          gross_amount: number;
          tech_split_pct: number;
          net_payout?: number | null;
          stripe_transfer_id?: string | null;
          status?: PayoutStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          ro_id?: string;
          organization_id?: string;
          tech_user_id?: string | null;
          split_role?: PayoutSplitRole | null;
          gross_amount?: number;
          tech_split_pct?: number;
          net_payout?: number | null;
          stripe_transfer_id?: string | null;
          status?: PayoutStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payout_splits_ro_id_fkey';
            columns: ['ro_id'];
            referencedRelation: 'repair_orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payout_splits_tech_user_id_fkey';
            columns: ['tech_user_id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: {
      current_user_org_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: UserRole;
      };
      current_user_is: {
        Args: { roles: UserRole[] };
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      ro_stage: RoStage;
      hold_gate_type: HoldGateType;
      payout_status: PayoutStatus;
      payout_split_role: PayoutSplitRole;
    };
    CompositeTypes: Record<never, never>;
  };
}

/* ---- Convenience row/insert/update aliases ---------------------------- */
type PublicSchema = Database['public'];

export type Tables<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update'];

export type Organization = Tables<'organizations'>;
export type Location = Tables<'locations'>;
export type User = Tables<'users'>;
export type Vehicle = Tables<'vehicles'>;
export type RepairOrder = Tables<'repair_orders'>;
export type TotalLossAudit = Tables<'total_loss_audits'>;
export type HoldGateLog = Tables<'hold_gate_logs'>;
export type ProofOfPayment = Tables<'proof_of_payments'>;
export type PayoutSplit = Tables<'payout_splits'>;
