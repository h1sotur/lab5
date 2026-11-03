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

// створюємо теку кешу ще до початку приймання запитів
try {
  await mkdir(options.cache, { recursive: true });
} catch (err) {
  console.error(`Не вдалося створити теку кешу: ${err.message}`);
  process.exit(1);
}

console.log(options);