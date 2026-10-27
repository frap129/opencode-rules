import type { Plugin } from '@opencode/plugin';
import { createRuntime } from './runtime/create-runtime.js';
import {
  parsePluginOptions,
  resolveAdditionalRuleDirectories,
} from './config/plugin-options.js';

const openCodeRulesPlugin: Plugin.Plugin = {
  id: 'opencode-rules',
  async setup(context) {
    const { additionalRuleDirectories } = parsePluginOptions(context.options);
    const runtime = await createRuntime({
      client: context,
      directory: context.location.directory,
      projectDirectory: context.location.directory,
      additionalRuleDirectories: resolveAdditionalRuleDirectories(
        additionalRuleDirectories,
        context.location.directory
      ),
    });
    return runtime.wire(context as never);
  },
};

export default openCodeRulesPlugin;
