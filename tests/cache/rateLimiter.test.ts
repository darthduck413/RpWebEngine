import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../services/common/rateLimiter';

describe('World Model rate limiter', () => {
    it('never calls a failed task a second time', async () => {
        const limiter = createRateLimiter({ enabled: true, rpm: 5, windowMs: 10 });
        let calls = 0;
        const error = new Error('HTTP 429');

        await expect(limiter.schedule(async () => {
            calls += 1;
            throw error;
        })).rejects.toBe(error);

        expect(calls).toBe(1);
    });
});
