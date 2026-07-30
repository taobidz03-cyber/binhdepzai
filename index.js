// --- enhanced-load-tester-v2.js ---
// CHỈ DÙNG TRÊN HỆ THỐNG BẠN SỞ HỮU HOẶC CÓ SỰ CHO PHÉP BẰNG VĂN BẢN
const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');
const fs = require('fs');

class EnhancedLoadTester {
  constructor(targetUrl, options = {}) {
    this.url = new URL(targetUrl);
    this.concurrent = options.concurrent || 20;
    this.duration = options.duration || 30000;
    this.timeout = options.timeout || 5000;
    this.method = (options.method || 'GET').toUpperCase();
    this.headers = options.headers || {};
    this.body = options.body || null;
    this.verbose = options.verbose ?? false;
    this.exportReport = options.exportReport ?? false;

    this.results = {
      total: 0, success: 0, failed: 0,
      codes: {},
      code200: 0,
      code403: 0,
      code503: 0,
      timePoints: [],
      minTime: Infinity, maxTime: 0, avgTime: 0
    };
    this.running = false;
  }

  async sendRequest() {
    const start = performance.now();
    const client = this.url.protocol === 'https:' ? https : http;

    return new Promise((resolve) => {
      const req = client.request({
        protocol: this.url.protocol,
        hostname: this.url.hostname,
        port: this.url.port || (this.url.protocol === 'https:' ? 443 : 80),
        path: this.url.pathname + this.url.search,
        method: this.method,
        headers: this.headers,
        timeout: this.timeout
      }, (res) => {
        res.resume();
        res.on('end', () => resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          code: res.statusCode,
          time: performance.now() - start
        }));
      });

      req.on('error', (e) => resolve({
        ok: false, code: `ERR:${e.code}`, time: performance.now() - start
      }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, code: 'TIMEOUT', time: this.timeout });
      });

      if(this.body) req.write(this.body);
      req.end();
    });
  }

  async worker() {
    while(this.running) {
      const res = await this.sendRequest();
      this.results.total++;
      res.ok ? this.results.success++ : this.results.failed++;

      this.results.codes[res.code] = (this.results.codes[res.code] || 0) + 1;

      // Đếm riêng các mã yêu cầu
      if(res.code === 200) this.results.code200++;
      if(res.code === 403) this.results.code403++;
      if(res.code === 503) this.results.code503++;

      this.results.minTime = Math.min(this.results.minTime, res.time);
      this.results.maxTime = Math.max(this.results.maxTime, res.time);
      this.results.avgTime = (this.results.avgTime * (this.results.total - 1) + res.time) / this.results.total;
      this.results.timePoints.push(res.time);

      if(this.verbose) console.log(`[${res.code}] ${res.time.toFixed(2)}ms`);
    }
  }

  calcPercentile(p) {
    if(!this.results.timePoints.length) return 0;
    const sorted = [...this.results.timePoints].sort((a,b) => a-b);
    const idx = Math.ceil((p/100)*sorted.length) - 1;
    return sorted[Math.max(0, idx)].toFixed(2);
  }

  async start() {
    this.running = true;
    const workers = Array.from({length: this.concurrent}, () => this.worker());
    setTimeout(() => this.running = false, this.duration);
    await Promise.allSettled(workers);

    this.results.p50 = this.calcPercentile(50);
    this.results.p90 = this.calcPercentile(90);
    this.results.p99 = this.calcPercentile(99);
    this.results.rps = (this.results.total / (this.duration / 1000)).toFixed(1);

    if(this.exportReport) fs.writeFileSync('test-report-v2.json', JSON.stringify(this.results, null, 2));
    return this.results;
  }
}

// --- CHẠY KIỂM TRA ---
(async () => {
  const tester = new EnhancedLoadTester('https://graph.vshield.pro/', {
    concurrent: 999,
    duration: 2000000,
    timeout: 3000,
    method: 'GET',
    verbose: false,
    exportReport: true
  });

  console.log('Bắt đầu kiểm tra tải với theo dõi mã trạng thái...');
  const report = await tester.start();
  console.log('\n=== KẾT QUẢ KIỂM TRA ===');
  console.table({
    'Tổng yêu cầu': report.total,
    'Thành công': report.success,
    'Thất bại': report.failed,
    'Yêu cầu/giây': report.rps,
    'Thời gian TB': report.avgTime.toFixed(2)+'ms',
    'P50': report.p50+'ms',
    'P90': report.p90+'ms',
    'P99': report.p99+'ms',
    '---': '---',
    'Mã 200 OK': report.code200,
    'Mã 403 Cấm': report.code403,
    'Mã 503 Quá tải': report.code503
  });
  console.log('\nTất cả mã trạng thái nhận được:');
  console.table(report.codes);
})();
