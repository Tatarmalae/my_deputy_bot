const { Telegraf, Markup, Extra } = require('telegraf');
const config = require('config');
const logger = require('./errorHandler');
const Koa = require('koa');
const koaBody = require('koa-body');
const pool = require('./mysqlPool');

const addressData = require('./address.json');
const partyData = require('./party.json');

const BOT_TOKEN = config.get('BOT_TOKEN') || '';
const URL = config.get('URL') || '';
const PORT = config.get('PORT') || 3000;

let metaID;
let addressInfo = [];
let deputyInfo = [];
let partyInfo = [];

const bot = new Telegraf(BOT_TOKEN, { telegram: { webhookReply: false } });

bot.command('start', ({ reply }) => {
  reply('Для начала поиска вашего депутата мне нужно получить ваш адрес в формате «Город, улица, дом». Номер квартиры вводить не надо!\n\nНапример: Казань, Декабристов, 10').then();
});

//Запись в БД данных пользователя и его запрос
const setMetaData = (ctx) => {
  metaID = null;
  const connectMetaData = pool.connectMetaData;
  const meta = {
    user_id: ctx.message.chat.id,
    first_name: ctx.message.chat.first_name,
    nick_name: ctx.message.chat.username,
    text: ctx.message.text
  };
  return new Promise((resolve, reject) => {
    connectMetaData.query(
      `INSERT INTO meta SET ?`, meta,
      (err, results) => {
        return err ? reject(err) : resolve(results.insertId);
      }
    );
  });
};

//Обновление в БД запроса пользователя после выполненных действий
const updateMetaData = (column_name, ctx) => {
  const connectMetaData = pool.connectMetaData;
  const meta = {
    [column_name]: ctx
  };
  return new Promise((resolve, reject) => {
    connectMetaData.query(
      `UPDATE meta SET ? WHERE id=${metaID}`, meta,
      (err, results) => {
        return err ? reject(err) : resolve(results);
      }
    );
  });
};

//Поиск ID в индексе Sphinx по введенному адресу
const getAddressID = (ctx) => {
  let addressID = [];
  const connectSphinx = pool.connectSphinx;
  return new Promise((resolve, reject) => {
    connectSphinx.query(
      `SELECT * FROM UIK WHERE MATCH('${ctx}') LIMIT 10`,
      (err, results) => {
        if (err) return reject(err.message);

        results.forEach(item => {
          addressID.push(item.id);
        });
        return resolve(addressID);
      }
    );
  });
};

//Получение информации о адресе по ID
const getAddressInfo = (ctx) => {
  let addressButton = [];
  addressInfo = [];
  const connectUIK = pool.connectDB;
  return new Promise((resolve, reject) => {
    connectUIK.query(
      `SELECT * FROM uik WHERE id IN (${ctx}) ORDER BY LENGTH(house), address`,
      (err, results) => {
        if (err) return reject(err.message);

        results.forEach(item => {
          addressInfo.push(JSON.parse(JSON.stringify(item)));

          let address = item.address.split(', ');// Разобьем строку на массив
          address.splice(1, 1);// Удалим район
          addressButton.push(address.join(', '));// Склеим обратно в строку
        });
        return resolve(addressButton);
      }
    );
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
  await setMetaData(ctx).then(id => metaID = id).catch((err) => {
    throw err;
  });

  const message = ctx.message.text.replace(/[\/]/g, ' ');
  const result = await getAddressID(message).catch((err) => {
    throw err;
  });

  if (result.length > 0) {
    const address = await getAddressInfo(result).catch((err) => {
      throw err;
    });
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

  await updateMetaData('select_address', addressInfo[ctx.callbackQuery.data.match(/_[0-9]*/)[0].substr(1)]['address']).catch((err) => {
    throw err;
  });

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
      updateMetaData('select_deputy', addressData[uikID.indexes]['Ф.И.О. депутата']).catch((err) => {
        throw err;
      });

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
      let partyText = '';
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
        reply_markup: keyboardParty ? keyboardParty.reply_markup : null,
        disable_web_page_preview: true
      }).catch((err) => {
        throw err.response.description;
      });
    }
  });
});

bot.action(/deputy_[0-9]/, async (ctx) => {
  if (!deputyInfo) return;

  await updateMetaData('select_deputy', deputyInfo[ctx.callbackQuery.data.match(/_[0-9]*/)[0].substr(1)]['Ф.И.О. депутата']).catch((err) => {
    throw err;
  });

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

  await updateMetaData('select_party', partyInfo[ctx.callbackQuery.data.match(/_[0-9]*/)[0].substr(1)]['Округ']).catch((err) => {
    throw err;
  });

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

bot.catch((err, ctx) => {
  logger.logError(`Error for ${ctx.updateType} ` + err).then();
})

bot.telegram.setWebhook(`${URL}/my_deputy_bot`).then();

const app = new Koa();
app.use(koaBody());
app.use(async (ctx) => {
  if (ctx.method !== 'POST' || ctx.url !== '/my_deputy_bot') {
    return;
  }
  await bot.handleUpdate(ctx.request.body, ctx.response);
  ctx.status = 200;
});

app.listen(PORT);