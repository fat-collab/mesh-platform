/**
 * MESH Ops — repair-order customer communication log (RO-scoped).
 *
 * One RO → many communication entries across SMS / email / phone / internal
 * note, inbound or outbound, forming the customer-comms timeline in the drawer.
 */

export type CommChannel = 'SMS' | 'EMAIL' | 'PHONE' | 'NOTE';
export type CommDirection = 'INBOUND' | 'OUTBOUND';

export const COMM_CHANNEL_LABEL: Record<CommChannel, string> = {
  SMS: 'SMS',
  EMAIL: 'Email',
  PHONE: 'Phone',
  NOTE: 'Note',
};

export const COMM_DIRECTION_LABEL: Record<CommDirection, string> = {
  INBOUND: 'Inbound',
  OUTBOUND: 'Outbound',
};

export interface RepairOrderCommEntry {
  id: string;
  repairOrderId: string;
  channel: CommChannel;
  direction: CommDirection;
  recipient: string;
  content: string;
  senderName: string;
  createdAt: string;
}
