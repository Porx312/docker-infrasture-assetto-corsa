export type FatalProcessHandlersOptions = {
  serviceName: string;
  /** Injected for tests; defaults to process.exit */
  exit?: (code: number) => void;
  /** When true, unhandledRejection also exits (default false — bridges have recoverable rejects). */
  fatalUnhandledRejection?: boolean;
  log?: (message: string, ...args: unknown[]) => void;
};

/**
 * Install process-level fatal handlers.
 * uncaughtException → log + exit(1) so a supervisor can restart.
 * unhandledRejection → log only unless FATAL_UNHANDLED_REJECTION=1 / option.
 */
export function installFatalProcessHandlers(opts: FatalProcessHandlersOptions): void {
  const exitFn = opts.exit ?? ((code: number) => process.exit(code));
  const log = opts.log ?? console.error.bind(console);
  const fatalRejection =
    opts.fatalUnhandledRejection === true ||
    (process.env.FATAL_UNHANDLED_REJECTION || '').trim() === '1';

  process.on('uncaughtException', (err) => {
    log(`[${opts.serviceName}] uncaughtException:`, err);
    exitFn(1);
  });

  process.on('unhandledRejection', (reason) => {
    log(`[${opts.serviceName}] unhandledRejection:`, reason);
    if (fatalRejection) {
      exitFn(1);
    }
  });
}
