import { mergeConfig } from 'vite';
import base from '../../vite.config.ts';
export default mergeConfig(base, { server: { allowedHosts: ['web'] } });
