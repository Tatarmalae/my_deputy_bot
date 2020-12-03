const { Telegraf } = require('telegraf');
const config = require('config');
const Koa = require('koa');
const koaBody = require('koa-body');
const mysql = require('mysql2');

const BOT_TOKEN = config.get('BOT_TOKEN') || '';
const URL = config.get('URL') || '';
const PORT = config.get('PORT') || 3000;

const bot = new Telegraf(BOT_TOKEN);

bot.command('start', ({ reply }) => {
  reply('Для начала поиска необходимо ввести адрес, например, Казань Большая Красная, 100').then(() => {
    const connection = mysql.createConnection({
      host: '127.0.0.1',
      port: 9306,
      user: '',
      password: '',
      database: ''
    });
    connection.connect((err) => {
      if (err) {
        return console.error('Ошибка: ' + err.message);
      } else {
        console.log('Подключение к серверу MySQL успешно установлено');
        // simple query
        connection.query(
          'SELECT * FROM UIK WHERE MATCH(%s) LIMIT 10',
          (err, results, fields) => {
            console.log(results); // results contains rows returned by server
            console.log(fields); // fields contains extra meta data about results, if available
          }
        );
      }
    });
    // закрытие подключения
    connection.end((err) => {
      if (err) {
        return console.log('Ошибка: ' + err.message);
      }
      console.log('Подключение закрыто');
    });
  });
});

bot.telegram.setWebhook(`${URL}/my_deputy_bot`);

const app = new Koa();
app.use(koaBody());
app.use(async (ctx, next) => {
  if (ctx.method !== 'POST' || ctx.url !== '/my_deputy_bot') {
    return next();
  }
  await bot.handleUpdate(ctx.request.body, ctx.response);
  ctx.status = 200;
});

app.listen(PORT);