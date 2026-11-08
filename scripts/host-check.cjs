'use strict';
const fs = require('node:fs');
const https = require('node:https');
if (process.argv.includes('--help')) {
  console.log(
    'Set FLOW_EDIT_REST_CONFIG to an existing local REST API config. For verify also set FLOW_EDIT_INSTALLED_DIR. Modes: status, save, reload, open-test, menu, verify.',
  );
  process.exit(0);
}
const configPath = process.env.FLOW_EDIT_REST_CONFIG;
if (!configPath)
  throw new Error('Set FLOW_EDIT_REST_CONFIG; no vault paths or credentials are bundled.');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port: config.port,
        path,
        method,
        ca: config.crypto.cert,
        headers: { Authorization: 'Bearer ' + config.apiKey, Accept: 'application/json' },
        timeout: 12000,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (s) => {
          text += s;
        });
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error('Local API HTTP ' + res.statusCode));
          resolve(text ? JSON.parse(text) : { status: res.statusCode });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Local API timed out')));
    req.on('error', reject);
    req.end();
  });
}
(async () => {
  const mode = process.argv[2] || 'status';
  if (mode === 'reload') {
    console.log(JSON.stringify(await request('/commands/app%3Areload/', 'POST')));
    return;
  }
  if (mode === 'verify') {
    const directory = process.env.FLOW_EDIT_INSTALLED_DIR;
    if (!directory) throw Error('Set FLOW_EDIT_INSTALLED_DIR');
    const base = require('node:path').resolve(directory) + require('node:path').sep,
      version = JSON.parse(fs.readFileSync(base + 'manifest.json')).version,
      path = base + 'verification-' + version + '.json';
    const before = fs.existsSync(path) ? fs.statSync(path).mtimeMs : 0;
    await request('/commands/flow-edit%3Averify-installed-fixes/', 'POST');
    for (let n = 0; n < 140; n++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (fs.existsSync(path) && fs.statSync(path).mtimeMs > before) {
        let report;
        try {
          report = JSON.parse(fs.readFileSync(path, 'utf8'));
        } catch {
          continue;
        }
        console.log(
          JSON.stringify({
            passed: report.passed,
            checks: report.checks.length,
            error: report.error,
            documentRestored: report.documentRestored,
          }),
        );
        return;
      }
    }
    throw Error('Host verifier has not completed; do not reload while it is still running');
  }
  if (mode === 'open-test') {
    console.log(
      JSON.stringify(await request('/open/' + encodeURIComponent('测试插件.md'), 'POST')),
    );
    return;
  }
  if (mode === 'menu') {
    console.log(JSON.stringify(await request('/commands/flow-edit%3Ablock-menu/', 'POST')));
    return;
  }
  if (mode === 'save') {
    const list = await request('/commands/');
    const commands = Array.isArray(list) ? list : list.commands;
    const command = commands.find((c) => c.id === 'editor:save-file');
    if (!command) throw new Error('No native save command found');
    console.log(
      JSON.stringify(await request('/commands/' + encodeURIComponent(command.id) + '/', 'POST')),
    );
    return;
  }
  const result = await request('/commands/');
  const commands = Array.isArray(result) ? result : result.commands;
  console.log(
    JSON.stringify(
      {
        localApiReachable: true,
        commands: commands.filter((c) => /^flow-edit:/.test(c.id) || /reload|restart/i.test(c.id)),
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
