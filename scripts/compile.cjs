'use strict';
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function compile() {
  const configFile = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  if (configFile.error)
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root, {
    noEmit: false,
    noEmitOnError: true,
    rootDir: path.join(root, 'src'),
    outDir: path.join(root, '.host-build', 'modules'),
  });
  const program = ts.createProgram(config.fileNames, config.options);
  const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnostics(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (name) => name,
        getNewLine: () => '\n',
      }),
    );
  if (program.emit().emitSkipped) throw new Error('TypeScript refused to emit the runtime modules');
}
module.exports = { compile };
