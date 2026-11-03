import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, rename, rm, unlink } from 'node:fs/promises';
import superagent from 'superagent';
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

// відповідь-картинка; source каже, звідки вона взята: HIT (кеш) або MISS (http.cat)
function sendImage(res, image, source) {
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': image.length,
    'X-Cache': source,
  });
  res.end(image);
}

// читання з кешу: null означає «у кеші немає», інші помилки йдуть далі
async function readFromCache(filePath) {
  try {
    return await readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// запис у кеш через тимчасовий файл і rename, щоб файл ніколи не був записаний наполовину
async function saveToCache(filePath, data) {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, data);
    await rename(tmpPath, filePath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw err;
  }
}

// запит до http.cat: null, якщо картинку отримати не вдалося
async function fetchFromHttpCat(code) {
  try {
    const response = await superagent
      .get(`https://http.cat/${code}`)
      .buffer(true)
      .parse(superagent.parse.image);
    return Buffer.isBuffer(response.body) && response.body.length > 0 ? response.body : null;
  } catch (err) {
    console.error(`http.cat для ${code}: ${err.status ?? err.code ?? err.message}`);
    return null;
  }
}

async function handleGet(res, code, filePath) {
  let image = await readFromCache(filePath);
  let source = 'HIT';

  if (!image) {
    image = await fetchFromHttpCat(code);
    if (!image) {
      send(res, 404, 'Картинку не знайдено');
      return;
    }
    await saveToCache(filePath, image);
    source = 'MISS';
  }

  sendImage(res, image, source);
}

// збирання тіла запиту: for await читає потік частинами без колбеків
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handlePut(req, res, filePath) {
  const body = await readBody(req);
  if (body.length === 0) {
    send(res, 400, 'Тіло запиту порожнє: потрібна картинка');
    return;
  }
  await saveToCache(filePath, body);
  send(res, 201, 'Картинку збережено');
}

async function handleDelete(res, filePath) {
  try {
    await unlink(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      send(res, 404, 'Картинки немає в кеші');
      return;
    }
    throw err;
  }
  send(res, 200, 'Картинку видалено');
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

         if (req.method === 'GET') {
      await handleGet(res, code, filePath);
      return;
    }

    if (req.method === 'PUT') {
      await handlePut(req, res, filePath);
      return;
    }

    // сюди доходить лише DELETE: інші методи відсіяні вище
    await handleDelete(res, filePath);
  } catch (err) {
    console.error(err);
    if (res.headersSent) {
      res.end();
      return;
    }
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