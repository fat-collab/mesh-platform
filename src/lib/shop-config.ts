/**
 * MESH — shop profile & SOP configuration store (server-side, persistent).
 *
 * Filesystem-backed JSON (OS temp dir) so the config survives requests and dev
 * reloads. SERVER-ONLY (node:fs) — client imports types from
 * src/components/onboarding/types and reads/writes via /api/v1/shop/config.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ShopConfig } from '@/components/onboarding/types';

const STORE_FILE = path.join(os.tmpdir(), 'mesh-shop-config.json');

export function getShopConfig(): ShopConfig | null {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as ShopConfig;
  } catch {
    /* not configured yet */
  }
  return null;
}

export function saveShopConfig(config: ShopConfig): ShopConfig {
  const withTs: ShopConfig = { ...config, updatedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(withTs), 'utf8');
  } catch {
    /* best-effort persistence */
  }
  return withTs;
}
