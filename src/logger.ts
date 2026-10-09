/**
 * Minimal structured (JSON-lines) logger. Never pass secrets, message text or full phone numbers;
 * use maskPhone() when a user reference is needed for debugging.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  log(level, event, fields = {}) {
    const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  },
};

export const silentLogger: Logger = { log() {} };

/** "972501234567" → "9725*****567" */
export function maskPhone(phone: string): string {
  return phone.length <= 7 ? "***" : `${phone.slice(0, 4)}${"*".repeat(phone.length - 7)}${phone.slice(-3)}`;
}
