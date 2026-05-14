#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const LIVE_RELOAD_SCRIPT = `
<script>
(function(){
  const es = new EventSource('/__livereload');
  es.onmessage = () => location.reload();
})();
</script>`;

// SSE clients waiting for reload signals
const clients = new Set();

// Watch the whole project directory for changes
fs.watch(ROOT, { recursive: true }, (_, filename) => {
  if (!filename) return;
  // Ignore node_modules, hidden files, and the server itself
  if (filename.includes('node_modules') || filename.startsWith('.')) return;
  console.log(`  changed: ${filename}`);
  for (const res of clients) {
    res.write('data: reload\n\n');
  }
});

http.createServer((req, res) => {
  // SSE endpoint for live reload
  if (req.url === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const contentType = MIME[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });

    // Inject live-reload script before </body> in HTML files
    if (ext === '.html') {
      res.end(data.toString().replace('</body>', LIVE_RELOAD_SCRIPT + '</body>'));
    } else {
      res.end(data);
    }
  });
}).listen(PORT, () => {
  console.log(`\n  proj-map running at http://localhost:${PORT}\n`);
  console.log('  Editor:  http://localhost:' + PORT);
  console.log('  Output:  http://localhost:' + PORT + '/output.html\n');
});
