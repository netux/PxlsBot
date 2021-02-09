import * as Discord from 'discord.js';
import * as pg from 'pg';

import { Client } from '../client';
import * as database from '../database';
import { Command, Context } from '../command';
import * as logger from '../logger';
import { Color, truncate } from '../utils';

type DatabaseAuditLog = {
  /* eslint-disable camelcase */
  id: number,
  guild_id: string,
  user_id: string,
  command_id: string | null,
  message: string | null,
  timestamp: Date
  /* eslint-enable camelcase */
}

/**
 * Inserts an audit log entry.
 * @param {pg.PoolClient} connection The database connection.
 * @param {Discord.Message} message The message.
 * @param {string} commandID The command ID.
 */
export async function insertAuditLog(connection: pg.PoolClient, message: Discord.Message, commandID: string): Promise<void> {
  try {
    await connection.query(`
      INSERT INTO
        auditlog
        (guild_id, user_id, command_id, message)
      VALUES
        ($1, $2, $3, $4)
    `, [
      message.guild.id,
      message.author.id,
      commandID,
      message.content
    ]);
  } catch (err) {
    logger.error(err);
    logger.error('Could not insert into "auditlog" table.');
  }
}

async function execute({ client, message }: Context): Promise<void> {
  const args = message.content.split(' ');
  const embed = new Discord.MessageEmbed();
  embed.setColor(Color.rainbow.skyblue.toColorResolvable());
  if (args.length < 2) {
    try {
      const dbResult = await database.withConnection((connection) => connection.query(`
        SELECT
          *
        FROM
          auditlog
        WHERE
          guild_id = $1
      `, [
        message.guild.id
      ]));

      if (dbResult.rowCount < 1) {
        await message.channel.send('This server has no audit log entries.');
        return;
      }

      const formattedArr: string[] = [];
      for (const auditLog of <DatabaseAuditLog[]> dbResult.rows) {
        const user = await client.users.fetch(auditLog.user_id);
        const command = client.commands.find(cmd => cmd.id === auditLog.command_id);
        const commandID = command.id ?? auditLog.command_id;
        const timestamp = logger.getDateTime(auditLog.timestamp, true);
        formattedArr.push(`
          __**Audit Log #${auditLog.id}:**__ \`${commandID}\`
          **Time:** ${timestamp}
          **User:** ${user.tag}
          (${auditLog.user_id})
        `.trim());
      }

      const messageBuffer: [string[]] = [[]];
      let buffer = 0;
      for (let i = 0; i < formattedArr.length; i++) {
        const formattedStr = formattedArr[i];
        if (buffer + formattedStr.length > 2048) {
          messageBuffer.push([]);
          buffer = 0;
        }
        messageBuffer[messageBuffer.length - 1].push(formattedStr + '\n');
        buffer += formattedStr.length;
      }
      for (const formattedStr of messageBuffer) {
        embed.setDescription(formattedStr);
        await message.channel.send(embed);
      }
    } catch (err) {
      logger.error(err);
      await message.channel.send('Could not display audit log. Details have been logged.');
    }
    return;
  }

  if (isNaN(Number(args[1]))) {
    await message.channel.send('You must specify a valid audit log ID - not a number.');
    return;
  }
  const id = parseInt(args[1]);
  try {
    const dbResult = await database.withConnection((connection) => connection.query(`
      SELECT
        *
      FROM
        auditlog
      WHERE
        guild_id = $1
        AND id = $2
    `, [
      message.guild.id,
      id
    ]));
    if (dbResult.rowCount < 1) {
      await message.channel.send(`Could not find audit log by ID \`${id}\`.`);
      return;
    }
    const auditLog = dbResult.rows[0] as DatabaseAuditLog;
    const user = await client.users.fetch(auditLog.user_id);
    const command = client.commands.find(cmd => cmd.id === auditLog.command_id);
    const commandID = command.id ?? auditLog.command_id;
    embed.setTitle(`Audit Log #${id}`);
    embed.setAuthor(`${user.tag} (${user.id})`, user.displayAvatarURL({ dynamic: true }));
    embed.addField('Command', `\`${commandID}\``);
    embed.addField('Message Text', truncate('```\n' + auditLog.message + '```', 1024, ' ...', true));
    embed.setTimestamp(auditLog.timestamp);
    await message.channel.send(embed);
  } catch (err) {
    logger.error(`Could not search for audit log by ID '${id}'.`);
    logger.error(err);
    await message.channel.send(`Could not search for audit log by ID \`${id}\`.`);
  }
}

export const command = new Command({
  id: 'auditlog',
  name: 'Audit Log',
  category: 'Utility',
  description: 'Display actions taken with the bot.',
  usage: 'auditlog [id]',
  aliases: ['al', 'audit', 'auditlog', 'auditlogs'],
  serverOnly: true,
  permissions: Discord.Permissions.FLAGS.MANAGE_GUILD
});
command.execute = execute;

export async function setup(client: Client): Promise<void> {
  try {
    await database.withConnection((connection) => connection.query(`
      CREATE TABLE IF NOT EXISTS auditlog (
        id SERIAL NOT NULL PRIMARY KEY,
        guild_id VARCHAR(20) NOT NULL,
        user_id VARCHAR(20) NOT NULL,
        command_id TEXT,
        message TEXT,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));
  } catch (err) {
    logger.error('Could not insert "auditlog" table.');
    logger.fatal(err);
  }

  client.registerCommand(command);
}
