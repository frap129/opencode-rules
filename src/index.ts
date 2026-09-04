import type { Plugin } from '@opencode-ai/plugin';
import { createRuntime } from './runtime/create-runtime.js';

const openCodeRulesPlugin: Plugin.Plugin = {
  id: 'opencode-rules',
  async setup(context) {
    const runtime = await createRuntime({
      client: context,
      directory: context.location.directory,
      projectDirectory: context.location.directory,
    });
    return runtime.wire(context as never);
  },
};

export default openCodeRulesPlugin;
