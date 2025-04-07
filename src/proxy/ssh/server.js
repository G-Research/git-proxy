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
        // Add connection timeout and keepalive settings
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        readyTimeout: 10000,
        // debug: (msg) => {
        // console.debug('[SSH Debug]', msg);
        // },
      },
      this.handleClient.bind(this),
    );
  }

  async handleClient(client) {
    console.log('[SSH] Client connected');

    // Set up client error handling
    client.on('error', (err) => {
      console.error('[SSH] Client error:', err);
      // Don't end the connection on error, let it try to recover
    });

    // Handle client end
    client.on('end', () => {
      console.log('[SSH] Client disconnected');
    });

    // Handle client close
    client.on('close', () => {
      console.log('[SSH] Client connection closed');
    });

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
          const remoteGitSsh = new ssh2.Client();

          console.log('[SSH] Creating SSH connection to GitHub');

          // Add connection options
          const connectionOptions = {
            host: config.getProxyUrl().replace('https://', ''),
            port: 22,
            username: 'git',
            keepaliveInterval: 10000, // Send keepalive every 10 seconds
            keepaliveCountMax: 3, // Allow 3 missed keepalives before disconnecting
            readyTimeout: 10000, // Connection timeout after 10 seconds
            tryKeyboard: false, // Disable keyboard-interactive auth
            debug: (msg) => {
              console.debug('[GitHub SSH Debug]', msg);
            },
          };

          console.log('[SSH] Connection options', connectionOptions);

          // Get the client's SSH key that was used for authentication
          const clientKey = session._channel._client.userPrivateKeyz;
          console.log('[SSH] Client key:', clientKey ? 'Available' : 'Not available');

          // Add the private key based on what's available
          if (clientKey) {
            console.log('[SSH] Using client key to connect to GitHub');
            connectionOptions.privateKey = clientKey;
          } else {
            console.log('[SSH] No client key available, using proxy key');
            connectionOptions.privateKey = require('fs').readFileSync(
              config.getSSHConfig().hostKey.privateKeyPath,
            );
          }

          remoteGitSsh.on('ready', () => {
            console.log('[SSH] Connected to GitHub');

            // Execute the Git command on GitHub
            remoteGitSsh.exec(
              command,
              { env: { GIT_PROTOCOL: 'version=2' } },
              (err, githubStream) => {
                if (err) {
                  console.error('[SSH] Failed to execute command on GitHub:', err);
                  stream.write(err.toString());
                  stream.end();
                  return;
                }

                // Handle stream errors
                githubStream.on('error', (err) => {
                  console.error('[SSH] GitHub stream error:', err);
                  stream.write(err.toString());
                  stream.end();
                });

                // Handle stream close
                githubStream.on('close', () => {
                  console.log('[SSH] GitHub stream closed');
                  stream.pipe(githubStream).pipe(stream);
                  remoteGitSsh.end();
                });

                // Pipe data between client and GitHub
                stream.pipe(githubStream).pipe(stream);

                githubStream.on('exit', (code) => {
                  console.log(`[SSH] GitHub command exited with code ${code}`);
                  remoteGitSsh.end();
                });
              },
            );
          });

          remoteGitSsh.on('error', (err) => {
            console.error('[SSH] GitHub SSH error:', err);
            stream.write(err.toString());
            stream.end();
          });

          // Connect to GitHub
          remoteGitSsh.connect(connectionOptions);
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
