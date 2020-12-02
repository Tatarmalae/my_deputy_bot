const { Telegraf } = require('telegraf');
require('dotenv').config();
const Koa = require('koa');
const koaBody = require('koa-body');

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const URL = process.env.URL || "";
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);

// Set telegram webhook
bot.telegram.setWebhook(`${URL}/bot`);

const app = new Koa();
app.use(koaBody());
app.use(async (ctx, next) => {
  if (ctx.method !== 'POST' || ctx.url !== '/bot') {
    return next();
  }
  await bot.handleUpdate(ctx.request.body, ctx.response);
  ctx.status = 200;
});
app.use(async (ctx) => {
  ctx.body = 'Hello World'
})

app.listen(PORT);