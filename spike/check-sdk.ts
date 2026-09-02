// Toolchain check: confirms @gluwa/usc-sdk resolves and exposes the surface
// the worker will depend on. Read-only, no network calls.
import { proofProvider, chainInfo } from '@gluwa/usc-sdk';

const surface = {
  'proofProvider.service.ProofBuilder': typeof proofProvider?.service?.ProofBuilder,
  'chainInfo.PrecompileChainInfoProvider': typeof chainInfo?.PrecompileChainInfoProvider,
};

console.log('@gluwa/usc-sdk resolved. Exported surface:');
for (const [name, kind] of Object.entries(surface)) {
  console.log(`  ${kind === 'function' ? 'OK  ' : 'MISS'} ${name} (${kind})`);
}

const missing = Object.entries(surface).filter(([, k]) => k !== 'function');
if (missing.length > 0) {
  console.error(`\n${missing.length} expected export(s) missing.`);
  process.exit(1);
}
console.log('\nAll expected exports present.');
