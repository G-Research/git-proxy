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
          console.debug('SSH Debug:', msg);
        },
      },
      this.handleClient.bind(this),
    );
  }

  async handleClient(client) {
    console.log('Client connected', client);
    client.on('authentication', async (ctx) => {
      console.log(`Authentication attempt: ${ctx.method}`);

      if (ctx.method === 'publickey') {
        try {
          console.log(`CTX KEY: ${JSON.stringify(ctx.key)}`);
          // Get the key type and key data
          const keyType = ctx.key.algo;
          const keyData = ctx.key.data;

          // Format the key in the same way as stored in user's publicKeys (without comment)
          const keyString = `${keyType} ${keyData.toString('base64')}`;

          console.log(`Attempting public key authentication with key: ${keyString}`);

          // Find user by SSH key
          const user = await db.findUserBySSHKey(keyString);
          if (!user) {
            console.log('No user found with this SSH key');
            ctx.reject();
            return;
          }

          console.log(`Public key authentication successful for user ${user.username}`);
          client.username = user.username;
          ctx.accept();
        } catch (error) {
          console.error('Error during public key authentication:', error);
          // Let the client try the next key
          ctx.reject();
        }
      } else if (ctx.method === 'password') {
        // Only try password authentication if no public key was provided
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
          console.log('Password authentication attempted but public key was provided');
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
      console.log('Command', command);
      if (command.startsWith('git-')) {
        // Extract the repository path from the command
        // Remove quotes and 'git-' prefix, then trim any leading/trailing slashes
        const repoPath = command
          .replace('git-upload-pack', '')
          .replace('git-receive-pack', '')
          .replace(/^['"]|['"]$/g, '')
          .replace(/^\/+|\/+$/g, '');

        const req = {
          method: command === 'git-upload-pack' ? 'GET' : 'POST',
          originalUrl: repoPath,
          headers: {
            'user-agent': 'git/2.0.0',
            'content-type':
              command === 'git-receive-pack' ? 'application/x-git-receive-pack-request' : undefined,
          },
        };

        try {
          console.log('Executing chain', req);
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
