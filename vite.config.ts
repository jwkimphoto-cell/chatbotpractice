import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import path from 'path';

// .env.local 및 .env 파일 로드
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * 로컬에서 `npm run dev` 실행 시 Vercel 서버리스 함수(/api/chat.ts)를
 * 개발 서버 미들웨어로 구동하기 위한 Vite 플러그인
 */
function vercelApiDevPlugin(): Plugin {
  return {
    name: 'vercel-api-dev-server',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Method Not Allowed. POST 요청만 지원합니다.' }));
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer | string) => {
          body += chunk.toString();
        });

        req.on('end', async () => {
          try {
            // .env.local 변경 사항이 있을 수 있으므로 재로드
            dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

            const parsedBody = body ? JSON.parse(body) : {};

            (req as any).body = parsedBody;

            const vercelRes: any = res;
            if (!vercelRes.status) {
              vercelRes.status = function (code: number) {
                this.statusCode = code;
                return this;
              };
            }
            if (!vercelRes.json) {
              vercelRes.json = function (data: any) {
                this.setHeader('Content-Type', 'application/json; charset=utf-8');
                this.end(JSON.stringify(data));
                return this;
              };
            }

            // Vite의 ssrLoadModule을 통해 루트의 api/chat.ts 실행
            const chatModule = await server.ssrLoadModule('/api/chat.ts');
            if (typeof chatModule.default === 'function') {
              await chatModule.default(req, vercelRes);
            } else {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: 'api/chat.ts에 default 핸들러가 없습니다.' }));
            }
          } catch (err: any) {
            console.error('Local /api/chat error:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: err?.message || 'Internal Server Error' }));
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vercelApiDevPlugin()],
});
