'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const projectRoot = path.resolve(__dirname, '..');
// A small development-only CJS packer. No runtime dependencies are included in the plugin release.
function browserBundle() {
  const modules = [],
    ids = new Map(),
    licenses = new Map();
  function visit(file) {
    if (ids.has(file)) return ids.get(file);
    const id = modules.length;
    ids.set(file, id);
    modules.push('');
    if (file.includes('node_modules')) {
      let dir = path.dirname(file);
      while (!fs.existsSync(path.join(dir, 'package.json')) && path.dirname(dir) !== dir)
        dir = path.dirname(dir);
      if (!licenses.has(dir)) {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        const license = ['LICENSE', 'LICENSE.txt', 'LICENSE.md']
          .map((n) => path.join(dir, n))
          .find((n) => fs.existsSync(n));
        licenses.set(
          dir,
          `${manifest.name} ${manifest.version}\n${license ? fs.readFileSync(license, 'utf8') : manifest.license || ''}`,
        );
      }
    }
    let source = fs.readFileSync(file, 'utf8');
    source = source.replace(/require\((['"])([^'"]+)\1\)/g, (match, quote, request) => {
      if (request === 'obsidian') return 'window.FlowObsidian';
      const target = require.resolve(request, { paths: [path.dirname(file)] });
      return `load(${visit(target)})`;
    });
    modules[id] = `function(module,exports){\n${source}\n}`;
    return id;
  }
  const entry = visit(path.join(__dirname, 'preview-client.js'));
  const notices = [...licenses.values()].join('\n\n');
  return `/* Third-party notices for the development preview:\n${notices.replace(/\*\//g, '* /')}\n*/\n(function(){const modules=[${modules.join(',\n')}],cache={};function load(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;modules[id](m,m.exports);return m.exports;}load(${entry});})();`;
}
const bundle = browserBundle();
const page = fs.readFileSync(path.join(__dirname, 'preview.html'), 'utf8');
const style = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');
// The plugin repository can be previewed without checking out the optional theme.
const themePath = path.join(projectRoot, '..', 'lumen-docs', 'theme.css');
const readTheme = () => (fs.existsSync(themePath) ? fs.readFileSync(themePath, 'utf8') : '');
const theme = readTheme();
const standalone = page
  .replace('<link rel="stylesheet" href="/theme.css">', '<style>' + theme + '</style>')
  .replace('<link rel="stylesheet" href="/styles.css">', '<style>' + style + '</style>')
  .replace(
    '<script src="/preview-bundle.js"></script>',
    '<script>' + bundle.replace(/<\/script/gi, '<\\/script') + '</script>',
  );
fs.writeFileSync(path.join(projectRoot, 'flow-edit-preview.html'), standalone);
if (process.argv.includes('--build-only')) {
  console.log('Built standalone interactive preview.');
  process.exit(0);
}
http
  .createServer((req, res) => {
    const routes = {
      '/': ['text/html', fs.readFileSync(path.join(__dirname, 'preview.html'), 'utf8')],
      '/theme.css': ['text/css', readTheme()],
      '/styles.css': ['text/css', fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8')],
      '/preview-bundle.js': [
        'text/javascript',
        req.url === '/preview-bundle.js' ? browserBundle() : '',
      ],
    };
    const route = routes[req.url];
    if (!route) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader('Content-Type', route[0] + '; charset=utf-8');
    res.end(route[1]);
  })
  .listen(18767, '127.0.0.1', () => console.log('Flow Edit preview: http://127.0.0.1:18767'));
