import { describe, expect, it } from 'vitest';
import { presignUrl } from '../src/lib/sigv4.js';

describe('presignUrl (SigV4)', () => {
  // Example from AWS docs: "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)".
  it('matches the AWS published example', () => {
    const url = presignUrl({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresInSeconds: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('signs extra headers so the client cannot change them', () => {
    const url = new URL(
      presignUrl({
        method: 'PUT',
        host: 'acct.r2.cloudflarestorage.com',
        path: '/bucket/products/p/i.webp',
        region: 'auto',
        accessKeyId: 'k',
        secretAccessKey: 's',
        expiresInSeconds: 300,
        headers: { 'Content-Type': 'image/webp', 'Content-Length': '1234' },
      }),
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
  });
});
