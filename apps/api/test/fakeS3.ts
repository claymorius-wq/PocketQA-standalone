import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

/**
 * Minimal path-style S3 stand-in for the R2 adapter tests: HEAD, ranged GET, presigned
 * PUT, CopyObject and DELETE, with presigned-URL expiry and failure injection. It does not
 * verify signatures (real R2 does; see the real-provider gates in ADR 0005).
 */
export class FakeS3 {
  objects = new Map<string, { body: Buffer; contentType: string }>();
  failDeletes = false;
  puts: { key: string; contentType: string | undefined; signedHeaders: string }[] = [];
  private server: Server | null = null;
  port = 0;

  async start() {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const [, bucket, ...rest] = url.pathname.split('/');
      const key = decodeURIComponent(rest.join('/'));
      const id = `${bucket}/${key}`;
      const xml = (status: number, body: string) => {
        res.writeHead(status, { 'content-type': 'application/xml' });
        res.end(body);
      };
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const obj = this.objects.get(id);
        const etag = (b: Buffer) => `"${createHash('md5').update(b).digest('hex')}"`;
        if (req.method === 'HEAD') {
          if (!obj) return void (res.writeHead(404), res.end());
          res.writeHead(200, { 'content-length': String(obj.body.length), 'content-type': obj.contentType, etag: etag(obj.body) });
          return void res.end();
        }
        if (req.method === 'GET') {
          if (!obj) return xml(404, '<Error><Code>NoSuchKey</Code></Error>');
          if (req.headers['if-match'] && req.headers['if-match'] !== etag(obj.body)) return xml(412, '<Error><Code>PreconditionFailed</Code></Error>');
          const m = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ''));
          if (m) {
            const start = Number(m[1]);
            const end = Math.min(Number(m[2]), obj.body.length - 1);
            res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${obj.body.length}`, 'content-length': String(end - start + 1), 'content-type': obj.contentType });
            return void res.end(obj.body.subarray(start, end + 1));
          }
          res.writeHead(200, { 'content-length': String(obj.body.length), 'content-type': obj.contentType });
          return void res.end(obj.body);
        }
        if (req.method === 'DELETE') {
          if (this.failDeletes) return xml(500, '<Error><Code>InternalError</Code></Error>');
          this.objects.delete(id);
          return void (res.writeHead(204), res.end());
        }
        if (req.method === 'PUT' && req.headers['x-amz-copy-source']) {
          const src = this.objects.get(decodeURIComponent(String(req.headers['x-amz-copy-source']).replace(/^\//, '')));
          if (!src) return xml(404, '<Error><Code>NoSuchKey</Code></Error>');
          const want = req.headers['x-amz-copy-source-if-match'];
          if (want && want !== etag(src.body)) return xml(412, '<Error><Code>PreconditionFailed</Code></Error>');
          this.objects.set(id, { body: Buffer.from(src.body), contentType: src.contentType });
          return xml(200, '<CopyObjectResult><ETag>"e"</ETag><LastModified>2026-10-04T00:00:00.000Z</LastModified></CopyObjectResult>');
        }
        if (req.method === 'PUT') {
          // Presigned PUT: must carry a signature and be within its lifetime.
          const date = url.searchParams.get('X-Amz-Date') ?? '';
          const expires = Number(url.searchParams.get('X-Amz-Expires') ?? '0');
          const issued = Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
          if (!url.searchParams.get('X-Amz-Signature') || !(issued + expires * 1000 > Date.now())) return xml(403, '<Error><Code>AccessDenied</Code></Error>');
          const body = Buffer.concat(chunks);
          if (Number(req.headers['content-length']) !== body.length) return xml(400, '<Error><Code>BadDigest</Code></Error>');
          this.puts.push({ key, contentType: req.headers['content-type'], signedHeaders: url.searchParams.get('X-Amz-SignedHeaders') ?? '' });
          this.objects.set(id, { body, contentType: String(req.headers['content-type'] ?? 'application/octet-stream') });
          return void (res.writeHead(200, { etag: '"e"' }), res.end());
        }
        return xml(405, '<Error><Code>MethodNotAllowed</Code></Error>');
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', () => r()));
    this.port = (this.server.address() as { port: number }).port;
    return `http://127.0.0.1:${this.port}`;
  }

  keys() {
    return [...this.objects.keys()];
  }

  async stop() {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }
}
