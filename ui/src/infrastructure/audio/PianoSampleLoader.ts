/**
 * Back-compat re-export of `loadPianoSamples` from SampleLoader.
 * New code should import from `./SampleLoader` directly. This shim
 * exists so that existing dynamic imports in App.tsx and the
 * historical test suite continue to work without churn.
 */

export { loadPianoSamples } from './SampleLoader';
