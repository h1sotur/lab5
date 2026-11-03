import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { Command } from 'commander';

const program = new Command();
program
  .helpOption('--help', 'показати довідку')
  .requiredOption('-h, --host <address>', 'адреса сервера')
  .requiredOption('-p, --port <number>', 'порт сервера')
  .requiredOption('-c, --cache <path>', 'тека для кешу картинок');

program.parse();
const options = program.opts();

const ALLOWED_METHODS = ['GET', 'PUT', 'DELETE'];

// створюємо теку кешу ще до початку приймання запитів
try {
  await mkdir(options.cache, { recursive: true });
} catch (err) {
  console.error(`Не вдалося створити теку кешу: ${err.message}`);
  process.exit(1);
}

// проста текстова відповідь
function send(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}

// єдиний дозволений колбек: обробник запиту
const server = http.createServer(async (req, res) => {
  try {
    if (!ALLOWED_METHODS.includes(req.method)) {
      send(res, 405, 'Метод не дозволений', { Allow: ALLOWED_METHODS.join(', ') });
      return;
    }

    // тільки шлях виду /ТРИ_ЦИФРИ, наприклад /200 або /404
    const { pathname } = new URL(req.url, 'http://localhost');
    const match = /^\/(\d{3})$/.exec(pathname);
    if (!match) {
      send(res, 404, 'Шлях має бути у форматі /<код стану з трьох цифр>');
      return;
    }

    const code = match[1];
    const filePath = path.join(options.cache, `${code}.jpg`);

    // заглушка, далі тут з'являться GET, PUT і DELETE
    send(res, 200, `Заглушка: ${req.method} ${code} -> ${filePath}`);
  } catch (err) {
    console.error(err);
    send(res, 500, 'Внутрішня помилка сервера');
  }
});

// запуск без колбека: чекаємо подію listening через проміс
try {
  server.listen(Number(options.port), options.host);
  await once(server, 'listening');
  console.log(`Сервер: http://${options.host}:${options.port}`);
} catch (err) {
  console.error(`Не вдалося запустити сервер: ${err.message}`);
  process.exit(1);
}