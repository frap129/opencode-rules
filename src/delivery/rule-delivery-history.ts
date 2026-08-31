export type RawHistoryResult =
  { ok: true; messages: readonly unknown[] } | { ok: false };

export interface RawHistoryAdapter {
  readHistory(sessionID: string): Promise<RawHistoryResult>;
}
