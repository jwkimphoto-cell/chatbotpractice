// Node 내장 타입 제거(type stripping)로 .ts를 직접 실행할 때, 확장자 없는 import('./meta')와
// '.js'로 적은 서버 import('./scenes.js')를 실제 .ts 파일로 찾아 주는 resolve 훅 (테스트·eval 전용, 의존성 없음)
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && context.parentURL.startsWith('file:')) {
    const base = new URL(specifier, context.parentURL);
    const p = fileURLToPath(base);
    const candidates = [];
    if (p.endsWith('.js')) candidates.push(p.slice(0, -3) + '.ts');
    if (!/\\.[cm]?[jt]sx?$/.test(p)) candidates.push(p + '.ts', p + '.tsx', p + '/index.ts');
    if (!existsSync(p)) {
      for (const c of candidates) if (existsSync(c)) return next(new URL('file://' + c).href, context);
    }
  }
  return next(specifier, context);
}
`),
  import.meta.url,
);
