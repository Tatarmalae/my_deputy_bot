const { Telegraf, Markup, Extra } = require('telegraf');
const config = require('config');
const Koa = require('koa');
const koaBody = require('koa-body');
const mysql = require('mysql2');
const addressData = require('./address.json');
const partyData = require('./party.json');

const BOT_TOKEN = config.get('BOT_TOKEN') || '';
const URL = config.get('URL') || '';
const PORT = config.get('PORT') || 3000;

const DB = config.get('DB');
const SPHINX = config.get('SPHINX');
const METADATA = config.get('METADATA');

let addressInfo = [];
let deputyInfo = [];
let partyInfo = [];

const bot = new Telegraf(BOT_TOKEN, { telegram: { webhookReply: false } });

bot.command('start', ({ reply }) => {
  reply('Для начала поиска вашего депутата мне нужно получить ваш адрес в формате «Город, улица, дом». Номер квартиры вводить не надо!\n\nНапример: Казань, Декабристов, 10');
});

const setMetaData = (ctx) => {
  const connectMetaData = mysql.createConnection(METADATA);
  const meta = {
    user_id: ctx.message.chat.id,
    first_name: ctx.message.chat.first_name,
    nick_name: ctx.message.chat.username,
    text: ctx.message.text,
  };
  connectMetaData.query(`SET NAMES utf8mb4`);
  return new Promise((resolve, reject) => {
    connectMetaData.query(
      `INSERT INTO meta SET ?`, meta,
      (err, results) => {

        return err ? reject(err) : resolve(results);
      }
    );
    connectMetaData.end();
  });
}

//Поиск ID в таблице по введенному адресу
const getAddressID = (ctx) => {
  let addressID = [];
  const connectSphinx = mysql.createConnection(SPHINX);
  return new Promise((resolve, reject) => {
    connectSphinx.query(
      `SELECT * FROM UIK WHERE MATCH('${ctx}') LIMIT 10`,
      (err, results) => {
        results.forEach(item => {
          addressID.push(item.id);
        });
        return err ? reject(err) : resolve(addressID);
      }
    );
    connectSphinx.end();
  });
};

//Получение информации о адресе по ID
const getAddressInfo = (ctx) => {
  let addressButton = [];
  addressInfo = [];
  const connectUIK = mysql.createConnection(DB);
  return new Promise((resolve, reject) => {
    connectUIK.query(
      `SELECT * FROM uik WHERE id IN (${ctx}) ORDER BY LENGTH(house), address`,
      (err, results) => {
        results.forEach(item => {
          addressInfo.push(JSON.parse(JSON.stringify(item)));

          let address = item.address.split(', ');// Разобьем строку на массив
          address.splice(1, 1);// Удалим район
          addressButton.push(address.join(', '));// Склеим обратно в строку
        });
        return err ? reject(err) : resolve(addressButton);
      }
    );
    connectUIK.end();
  });
};

//Поиск УИК по адресу
const searchUIK = (where, needle) => {
  let found = [];
  const re = new RegExp(`\\b${needle}\\b`, 'u');
  where.forEach((item, ix) => {
    if (!item['УИК']) return;
    if (item['УИК'].match(re)) {
      if (found.indexOf(ix) === -1) {
        found.push(ix);
      }
    }
  });
  return { searched: needle, indexes: found };
};

//Поиск партии
const searchParty = (where, needle) => {
  let found = [];
  const re = new RegExp(`${needle}`, 'u');
  where.forEach((item, ix) => {
    if (!item['№ п/п']) return;
    if (item['№ п/п'].match(re)) {
      if (found.indexOf(ix) === -1) {
        found.push(ix);
      }
    }
  });
  return { searched: needle, indexes: found };
};

//Поиск депутатов партии
const searchPartyDeputy = (where, needle) => {
  let found = [];
  const re = new RegExp(`${needle}`, 'u');
  where.forEach((item, ix) => {
    if (!item['Округ']) return;
    if (item['Округ'].match(re)) {
      if (found.indexOf(ix) === -1) {
        found.push(ix);
      }
    }
  });
  return { searched: needle, indexes: found };
};

bot.on('text', async (ctx) => {
  //const setMeta = setMetaData(ctx).then().catch();

  const message = ctx.message.text.replace(/[\/]/g, ' ');
  const result = await getAddressID(message);
  if (result.length > 0) {
    const address = await getAddressInfo(result);
    let inlineKeyboardAddress = [];
    address.forEach((item, index) => {
      inlineKeyboardAddress.push(Markup.callbackButton(`${item}`, `uik_${index}`));
    });
    let keyboardAddress = Extra.HTML().markup(Markup.inlineKeyboard(inlineKeyboardAddress, {
      columns: 1
    }).resize());
    return ctx.reply('🗺️ Выберите адрес:', keyboardAddress);
  } else {
    return ctx.reply('🤷‍♂‍ К сожалению, я не смог ничего найти. Проверьте правильность написания адреса.\n\nДавайте попробуем еще раз! Мне нужен ваш адрес: Город, улица, дом. Номер квартиры вводить не надо!\n\nНапример: Казань, Декабристов, 10');
  }
});

bot.action(/uik_[0-9]/, async (ctx) => {
  if (!addressInfo) return;

  const uik = await addressInfo[ctx.callbackQuery.data.match(/_[0-9]*/)[0].substr(1)]['uik'];
  await ctx.answerCbQuery('⌛ Информация загружается ⌛').then(() => {
    const uikID = searchUIK(addressData, uik);
    if (uikID.indexes.length > 1) {
      let inlineKeyboardDeputy = [];
      deputyInfo = [];
      uikID.indexes.forEach((item, ix) => {
        deputyInfo.push(addressData[item]);

        inlineKeyboardDeputy.push(Markup.callbackButton(`${addressData[item]['Ф.И.О. депутата']}`, `deputy_${ix}`));
      });

      let keyboardDeputy = Extra.HTML().markup(Markup.inlineKeyboard(inlineKeyboardDeputy, {
        columns: 1
      }).resize());

      ctx.deleteMessage();
      return ctx.reply('🗺️ Выберите депутата:', keyboardDeputy);
    } else {
      const fio = addressData[uikID.indexes]['Ф.И.О. депутата'] ? '<b>' + addressData[uikID.indexes]['Ф.И.О. депутата'] + '</b>\n' : '';
      const position = addressData[uikID.indexes]['Должность, место работы'] ? addressData[uikID.indexes]['Должность, место работы'] + '\n\n' : '';
      const reception = addressData[uikID.indexes]['Ведет прием:'] ? '🗓 Ведет прием: ' + addressData[uikID.indexes]['Ведет прием:'] + '\n\n' : '';
      const address = addressData[uikID.indexes]['Адрес:'] ? '📍 Адрес: ' + addressData[uikID.indexes]['Адрес:'] + '\n\n' : '';
      const phone = addressData[uikID.indexes]['Телефон:'] ? '☎️ Телефон: ' + addressData[uikID.indexes]['Телефон:'] + '\n\n' : '';
      const email = addressData[uikID.indexes]['E-mail:'] ? '✉️ E-mail: ' + addressData[uikID.indexes]['E-mail:'] + '\n\n' : '';
      const details = addressData[uikID.indexes]['Подробнее о депутате:'] ? '🔎 Подробнее о депутате: ' + addressData[uikID.indexes]['Подробнее о депутате:'] : '';

      //Найдём партии по № п/п депутата
      const numbPP = addressData[uikID.indexes]['№ п/п'];
      const partyID = searchParty(partyData, numbPP);
      let partyText;
      let inlineKeyboardParty = [];
      let keyboardParty;
      if (partyID.indexes.length) {
        partyText = '\n\n' + '📣 Также вы можете обратиться к депутатам политических партий:' + '\n\n';

        partyInfo = [];
        partyID.indexes.forEach((item, ix) => {
          partyInfo.push(partyData[item]);

          inlineKeyboardParty.push(Markup.callbackButton(`${partyData[item]['Округ']}`, `party_${ix}`));
        });

        let uniqueInlineKeyboardParty = [...new Set(inlineKeyboardParty.map(item => item.text))].map(text => {
          return inlineKeyboardParty.find(item => item.text === text);
        });
        keyboardParty = Extra.HTML().markup(Markup.inlineKeyboard(uniqueInlineKeyboardParty, {
          columns: 1
        }).resize());
      }

      const dataMessage = fio + position + reception + address + phone + email + details + partyText;

      ctx.deleteMessage();
      return ctx.reply(dataMessage, {
        parse_mode: 'HTML',
        reply_markup: keyboardParty.reply_markup,
        disable_web_page_preview: true
      }).catch((err) => console.log('!!!ERROR!!!', err.response.description));
    }
  });
});

bot.action(/deputy_[0-9]/, async (ctx) => {
  if (!deputyInfo) return;

  const deputy = await deputyInfo[ctx.callbackQuery.data.match(/_[0-9]*/)[0].substr(1)];
  await ctx.answerCbQuery('⌛ Информация загружается ⌛').then(() => {
    const fio = deputy['Ф.И.О. депутата'] ? '*' + deputy['Ф.И.О. депутата'] + '*\n' : '';
    const position = deputy['Должность, место работы'] ? deputy['Должность, место работы'] + '\n\n' : '';
    const reception = deputy['Ведет прием:'] ? '🗓 Ведет прием: ' + deputy['Ведет прием:'] + '\n\n' : '';
    const address = deputy['Адрес:'] ? '📍 Адрес: ' + deputy['Адрес:'] + '\n\n' : '';
    const phone = deputy['Телефон:'] ? '☎️ Телефон: ' + deputy['Телефон:'] + '\n\n' : '';
    const email = deputy['E-mail:'] ? '✉️ E-mail: ' + deputy['E-mail:'] + '\n\n' : '';
    const details = deputy['Подробнее о депутате:'] ? '🔎 Подробнее о депутате: ' + deputy['Подробнее о депутате:'] : '';

    const dataMessage = fio + position + reception + address + phone + email + details;

    ctx.deleteMessage();
    return ctx.replyWithMarkdown(dataMessage, {
      disable_web_page_preview: true
    });
  });
});

bot.action(/party_[0-9]/, async (ctx) => {
  if (!partyInfo) return;

  const party = await partyInfo[ctx.callbackQuery.data.match(/_[0-9]*/)[0].substr(1)];
  await ctx.answerCbQuery('⌛ Информация загружается ⌛').then(() => {
    const partyID = searchPartyDeputy(partyData, party['Округ']);
    if (partyID.indexes.length) {
      let inlineKeyboardDeputy = [];
      deputyInfo = [];
      partyID.indexes.forEach((item, ix) => {
        deputyInfo.push(partyData[item]);

        inlineKeyboardDeputy.push(Markup.callbackButton(`${partyData[item]['Ф.И.О. депутата']}`, `deputy_${ix}`));
      });

      let keyboardDeputy = Extra.HTML().markup(Markup.inlineKeyboard(inlineKeyboardDeputy, {
        columns: 1
      }).resize());

      ctx.deleteMessage();
      return ctx.reply('🗺️ Выберите депутата:', keyboardDeputy);
    }
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