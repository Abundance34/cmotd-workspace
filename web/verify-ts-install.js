const fs = require('fs');
const path = require('path');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
console.log('ProcureFlow package dependencies:', Object.keys(pkg.dependencies || {}).sort().join(', '));
try {
  console.log('typescript resolved:', require.resolve('typescript/package.json'));
} catch (error) {
  console.error('typescript resolve failed:', error.message);
  process.exitCode = 2;
}
