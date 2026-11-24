// Node 내장 타입 제거(type stripping)로 .ts를 직접 실행할 때, 확장자 없는 import('./meta')와
// '.js'로 적은 서버 import('./scenes.js')를 실제 .ts 파일로 찾아 주는 resolve 훅 (테스트·eval 전용, 의존성 없음)
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
      const p = fileURLToPath(new URL(specifier, context.parentURL));
      if (!existsSync(p)) {
        const candidates = p.endsWith('.js') ? [p.slice(0, -3) + '.ts'] : /\.[cm]?[jt]sx?$/.test(p) ? [] : [p + '.ts', p + '.tsx', p + '/index.ts'];
        const hit = candidates.find((c) => existsSync(c));
        if (hit) return nextResolve(pathToFileURL(hit).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
