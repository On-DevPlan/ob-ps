declare global {
  /** Minimal Moment interface for Obsidian's runtime moment */
  interface Moment {
    isSame(compare: Moment, granularity?: string): boolean;
    format(formatStr?: string): string;
  }

  interface Window {
    moment(inp?: number | string | Date): Moment;
  }
}

export {};
