const Step = require('../../actions').Step;
const fs = require('fs');
const dir = './.remote';
const git = require('isomorphic-git');
const gitHttpClient = require('isomorphic-git/http/node');
const { execSync } = require('child_process');
const config = require('../../../config');

const exec = async (req, action) => {
  const step = new Step('pullRemote');

  try {
    action.proxyGitPath = `${dir}/${action.timestamp}`;

    step.log(`Creating folder ${action.proxyGitPath}`);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }

    if (!fs.existsSync(action.proxyGitPath)) {
      fs.mkdirSync(action.proxyGitPath, '0755', true);
    }

    const gitProtocol = config.getGitProtocol();
    let cloneUrl = action.url;

    if (gitProtocol === 'ssh') {
      // Convert HTTPS URL to SSH URL
      cloneUrl = action.url.replace('https://', 'git@');
      const cmd = `git clone ${cloneUrl}`;
      step.log(`Executing ${cmd}`);

      // Use native git command with SSH
      execSync(cmd, {
        cwd: action.proxyGitPath,
        stdio: 'pipe',
      });
    } else {
      // Use HTTPS with isomorphic-git
      const authHeader = req.headers?.authorization;
      const [username, password] = Buffer.from(authHeader.split(' ')[1], 'base64')
        .toString()
        .split(':');

      await git.clone({
        fs,
        http: gitHttpClient,
        url: cloneUrl,
        onAuth: () => ({
          username,
          password,
        }),
        dir: `${action.proxyGitPath}/${action.repoName}`,
      });
    }

    console.log('Clone Success: ', cloneUrl);

    step.log(`Completed clone for ${cloneUrl}`);
    step.setContent(`Completed clone for ${cloneUrl}`);
  } catch (e) {
    step.setError(e.toString('utf-8'));
    throw e;
  } finally {
    action.addStep(step);
  }
  return action;
};

exec.displayName = 'pullRemote.exec';
exports.exec = exec;
