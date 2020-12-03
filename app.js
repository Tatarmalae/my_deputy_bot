const {Telegraf} = require('telegraf');
const config = require('config');
const Koa = require('koa');
const koaBody = require('koa-body');

const BOT_TOKEN = config.get('BOT_TOKEN') || '';
const URL = config.get('URL') || '';
const PORT = config.get('PORT') || 3000;

const bot = new Telegraf(BOT_TOKEN);

bot.command('start', ({reply}) => {
    reply('Для начала поиска необходимо ввести адрес, например, Казань Большая Красная, 100')
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