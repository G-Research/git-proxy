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
        // debug: (msg) => {
        // console.debug('[SSH Debug]', msg);
        // },
      },
      this.handleClient.bind(this),
    );
  }

  async handleClient(client) {
    console.log('[SSH] Client connected', client);
    client.on('authentication', async (ctx) => {
      console.log(`[SSH] Authentication attempt: ${ctx.method}`);

      if (ctx.method === 'publickey') {
        try {
          console.log(`[SSH] CTX KEY: ${JSON.stringify(ctx.key)}`);
          // Get the key type and key data
          const keyType = ctx.key.algo;
          const keyData = ctx.key.data;

          // Format the key in the same way as stored in user's publicKeys (without comment)
          const keyString = `${keyType} ${keyData.toString('base64')}`;

          console.log(`[SSH] Attempting public key authentication with key: ${keyString}`);

          // Find user by SSH key
          const user = await db.findUserBySSHKey(keyString);
          if (!user) {
            console.log('[SSH] No user found with this SSH key');
            ctx.reject();
            return;
          }

          console.log(`[SSH] Public key authentication successful for user ${user.username}`);
          client.username = user.username;
          // Store the user's private key for later use with GitHub
          client.userPrivateKey = ctx.key;
          ctx.accept();
        } catch (error) {
          console.error('[SSH] Error during public key authentication:', error);
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
                console.log(`[SSH] Password authentication successful for user ${ctx.username}`);
                ctx.accept();
              } else {
                console.log(`[SSH] Password authentication failed for user ${ctx.username}`);
                ctx.reject();
              }
            } else {
              console.log(`[SSH] User ${ctx.username} not found or no password set`);
              ctx.reject();
            }
          } catch (error) {
            console.error('[SSH] Error during password authentication:', error);
            ctx.reject();
          }
        } else {
          console.log('[SSH] Password authentication attempted but public key was provided');
          ctx.reject();
        }
      } else {
        console.log(`Unsupported authentication method: ${ctx.method}`);
        ctx.reject();
      }
    });

    client.on('ready', () => {
      console.log(`[SSH] Client ready: ${client.username}`);
      client.on('session', this.handleSession.bind(this));
    });

    client.on('error', (err) => {
      console.error('[SSH] Client error:', err);
    });
  }

  async handleSession(accept, reject) {
    const session = accept();
    session.on('exec', async (accept, reject, info) => {
      const stream = accept();
      const command = info.command;

      // Parse Git command
      console.log('[SSH] Command', command);
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
          isSSH: true,
          headers: {
            'user-agent': 'git/2.0.0',
            'content-type':
              command === 'git-receive-pack' ? 'application/x-git-receive-pack-request' : undefined,
          },
        };

        try {
          console.log('[SSH] Executing chain', req);
          const action = await chain.executeChain(req);

          console.log('[SSH] Action', action);

          if (action.error || action.blocked) {
            // If there's an error or the action is blocked, send the error message
            console.log(
              '[SSH] Action error or blocked',
              action.errorMessage || action.blockedMessage,
            );
            stream.write(action.errorMessage || action.blockedMessage);
            stream.end();
            return;
          }

          // Create SSH connection to GitHub
          const githubSsh = new ssh2.Client();

          console.log('[SSH] Creating SSH connection to GitHub');
          githubSsh.on('ready', () => {
            console.log('[SSH] Connected to GitHub');

            // Execute the Git command on GitHub
            githubSsh.exec(command, { env: { GIT_PROTOCOL: 'version=2' } }, (err, githubStream) => {
              if (err) {
                console.error('[SSH] Failed to execute command on GitHub:', err);
                stream.write(err.toString());
                stream.end();
                return;
              }

              // Pipe data between client and GitHub
              stream.pipe(githubStream).pipe(stream);

              githubStream.on('exit', (code) => {
                console.log(`[SSH] GitHub command exited with code ${code}`);
                githubSsh.end();
              });
            });
          });

          githubSsh.on('error', (err) => {
            console.error('[SSH] GitHub SSH error:', err);
            stream.write(err.toString());
            stream.end();
          });

          // Get the client's SSH key that was used for authentication
          // console.log('[SSH] Session:', session);
          const clientKey = session._channel._client.userPrivateKey;
          console.log('[SSH] Client key:', clientKey ? 'Available' : 'Not available');

          if (clientKey) {
            console.log('[SSH] Using client key to connect to GitHub');
            // Use the client's private key to connect to GitHub
            githubSsh.connect({
              host: 'github.com',
              port: 22,
              username: 'git',
              privateKey: clientKey,
            });
          } else {
            console.log('[SSH] No client key available, using proxy key');
            // Fallback to proxy's SSH key if no client key is available
            githubSsh.connect({
              host: 'github.com',
              port: 22,
              username: 'git',
              privateKey: require('fs').readFileSync(config.getSSHConfig().hostKey.privateKeyPath),
            });
          }
        } catch (error) {
          console.error('[SSH] Error during SSH connection:', error);
          stream.write(error.toString());
          stream.end();
        }
      } else {
        console.log('[SSH] Unsupported command', command);
        stream.write('Unsupported command');
        stream.end();
      }
    });
  }

  start() {
    const port = config.getSSHConfig().port;
    this.server.listen(port, '0.0.0.0', () => {
      console.log(`[SSH] Server listening on port ${port}`);
    });
  }
}

module.exports = SSHServer;
