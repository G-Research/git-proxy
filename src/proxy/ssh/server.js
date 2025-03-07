const ssh2 = require('ssh2');
const config = require('../../config');
const chain = require('../chain');
const db = require('../../db');

class SSHServer {
  constructor() {
    this.server = new ssh2.Server(
      {
        hostKeys: [require('fs').readFileSync(config.getSSHConfig().hostKey.privateKeyPath)],
        authMethods: ['publickey', 'password'],
        debug: (msg) => {
          console.log('SSH Debug:', msg);
        },
      },
      this.handleClient.bind(this),
    );
  }

  async handleClient(client) {
    client.on('authentication', async (ctx) => {
      console.log(`Authentication attempt: ${ctx.method} for user ${ctx.username}`);

      if (ctx.method === 'publickey') {
        try {
          const authorizedKeys = require('fs').readFileSync(
            config.getSSHConfig().authorizedKeysPath,
            'utf8',
          );

          // Get the key type and key data
          const keyType = ctx.key.type;
          const keyData = ctx.key.data;

          // Format the key in the same way as authorized_keys
          const keyString = `${keyType} ${keyData.toString('base64')}`;

          console.log('Offered key:', keyString);

          // Check if the key exists in authorized_keys
          const isAuthorized = authorizedKeys.split('\n').some((line) => {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith('#')) return false;

            // Parse the authorized key line
            const [type, key] = trimmedLine.split(' ');
            return type === keyType && key === keyData.toString('base64');
          });

          if (isAuthorized) {
            console.log(`Public key authentication successful for user ${ctx.username}`);
            ctx.accept();
          } else {
            console.log(`Public key authentication failed for user ${ctx.username}`);
            ctx.reject();
          }
        } catch (error) {
          console.error('Error during public key authentication:', error);
          ctx.reject();
        }
      } else if (ctx.method === 'password') {
        if (!ctx.key) {
          try {
            const user = await db.findUser(ctx.username);
            if (user && user.password) {
              const bcrypt = require('bcryptjs');
              const isValid = await bcrypt.compare(ctx.password, user.password);
              if (isValid) {
                console.log(`Password authentication successful for user ${ctx.username}`);
                ctx.accept();
              } else {
                console.log(`Password authentication failed for user ${ctx.username}`);
                ctx.reject();
              }
            } else {
              console.log(`User ${ctx.username} not found or no password set`);
              ctx.reject();
            }
          } catch (error) {
            console.error('Error during password authentication:', error);
            ctx.reject();
          }
        } else {
          console.log(
            `Password authentication attempted but public key was provided for user ${ctx.username}`,
          );
          ctx.reject();
        }
      } else {
        console.log(`Unsupported authentication method: ${ctx.method}`);
        ctx.reject();
      }
    });

    client.on('ready', () => {
      console.log(`Client ready: ${client.username}`);
      client.on('session', this.handleSession.bind(this));
    });

    client.on('error', (err) => {
      console.error('Client error:', err);
    });
  }

  async handleSession(accept, reject) {
    const session = accept();
    session.on('exec', async (accept, reject, info) => {
      const stream = accept();
      const command = info.command;

      // Parse Git command
      if (command.startsWith('git-')) {
        const req = {
          method: command === 'git-upload-pack' ? 'GET' : 'POST',
          originalUrl: command.replace('git-', ''),
          headers: {
            'user-agent': 'git/2.0.0',
            'content-type':
              command === 'git-receive-pack' ? 'application/x-git-receive-pack-request' : undefined,
          },
        };

        try {
          const action = await chain.executeChain(req);
          stream.write(action.getContent());
          stream.end();
        } catch (error) {
          stream.write(error.toString());
          stream.end();
        }
      } else {
        stream.write('Unsupported command');
        stream.end();
      }
    });
  }

  start() {
    const port = config.getSSHConfig().port;
    this.server.listen(port, '0.0.0.0', () => {
      console.log(`SSH server listening on port ${port}`);
    });
  }
}

module.exports = SSHServer;
