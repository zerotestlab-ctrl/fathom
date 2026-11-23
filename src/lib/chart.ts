export function chartBuckets(
  events: { blockNumber: number; timestamp: number | null }[],
): { label: string; count: number }[] {
  if (!events.length) return [];
  const times = events.map((event) => event.timestamp).filter((value): value is number => value !== null);
  if (times.length === events.length && Math.max(...times) - Math.min(...times) > 2 * 60 * 60) {
    const counts = new Map<number, number>();
    for (const event of events) {
      const hour = Math.floor((event.timestamp ?? 0) / 3600) * 3600;
      counts.set(hour, (counts.get(hour) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, count]) => ({
        label: new Date(hour * 1000).toISOString().slice(11, 16),
        count,
      }));
  }
  const blocks = events.map((event) => event.blockNumber);
  const min = Math.min(...blocks);
  const width = Math.max(1, Math.ceil((Math.max(...blocks) - min + 1) / 12));
  const counts = new Map<number, number>();
  for (const block of blocks) {
    const key = min + Math.floor((block - min) / width) * width;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([block, count]) => ({ label: String(block), count }));
}
