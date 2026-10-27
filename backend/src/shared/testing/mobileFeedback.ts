import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const mobileRequire = createRequire(resolve('../mobile/package.json'));
const ts = mobileRequire('typescript') as { transpileModule: (source: string, options: object) => { outputText: string }; ModuleKind: { CommonJS: number }; ScriptTarget: { ES2022: number } };
const policy: Record<string, unknown> = {};
runInNewContext(ts.transpileModule(readFileSync(resolve('../mobile/src/utils/userMessage.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: policy, Error });

/** UI harnesses render public copy; the mobile feedback suite tests the actual host/store. */
export function mobileFeedbackDependency(name: string): unknown {
  if (name === '@/utils/userMessage') return policy;
  if (name === '@/components/common/AppMessage') return {
    AppMessage: (props: Record<string, unknown>) => ({ type: 'Text', props: { ...props, children: (policy.safeMessage as (value: unknown) => string)(props.message) } }),
  };
  if (name === '@/store/feedbackStore') return { feedback: {
    show: () => undefined, success: () => undefined, error: () => undefined, alert: () => undefined,
    confirm: async () => true,
  } };
  return undefined;
}
