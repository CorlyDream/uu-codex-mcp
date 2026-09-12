/**
 * In-memory registry of terminals opened by this bridge process.
 * It intentionally starts empty after every process restart so cleanup never claims unknown sessions.
 */
export class OwnedTerminals {
  private readonly deviceIds = new Set<string>();

  markOpened(deviceId: string): void {
    this.deviceIds.add(deviceId);
  }

  isOwned(deviceId: string): boolean {
    return this.deviceIds.has(deviceId);
  }

  markClosed(deviceId: string): void {
    this.deviceIds.delete(deviceId);
  }

  listOwned(): string[] {
    return [...this.deviceIds].sort();
  }
}
