import type { FastifyPluginAsync } from 'fastify';

export interface HealthChecks {
  postgres: () => Promise<void>;
}

type DependencyState = 'connected' | 'unavailable';

/**
 * GET /health — used by UptimeRobot, Docker healthcheck and the CI deploy gate.
 * Returns 200 when every dependency responds, 503 otherwise.
 */
export const healthRoutes: FastifyPluginAsync<{ checks: HealthChecks }> = async (app, { checks }) => {
  app.get('/health', { config: { rateLimit: false } }, async (request, reply) => {
    const postgres = await probe(checks.postgres, (err) => request.log.warn({ err }, 'postgres health check failed'));
    const ok = postgres === 'connected';
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', postgres });
  });
};

async function probe(check: () => Promise<void>, onError: (err: unknown) => void): Promise<DependencyState> {
  try {
    await withTimeout(check(), 2000);
    return 'connected';
  } catch (err) {
    onError(err);
    return 'unavailable';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
