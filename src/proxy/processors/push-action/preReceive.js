const fs = require('fs');
const path = require('path');
const Step = require('../../actions').Step;
const { spawnSync } = require('child_process');

const sanitizeInput = (_req, action) => {
  return `${action.commitFrom} ${action.commitTo} ${action.branch} \n`;
};

const exec = async (req, action, hookFilePath = './hooks/pre-receive.sh') => {
  const step = new Step('executeExternalPreReceiveHook');

  try {
    const resolvedPath = path.resolve(hookFilePath);
    const hookDir = path.dirname(resolvedPath);

    if (!fs.existsSync(hookDir) || !fs.existsSync(resolvedPath)) {
      step.log('Pre-receive hook not found, skipping execution.');
      action.addStep(step);
      return action;
    }

    const repoPath = `${action.proxyGitPath}/${action.repoName}`;

    step.log(`Executing pre-receive hook from: ${resolvedPath}`);

    const sanitizedInput = sanitizeInput(req, action);

    const hookProcess = spawnSync(resolvedPath, [], {
      input: sanitizedInput,
      encoding: 'utf-8',
      cwd: repoPath,
    });

    const { stdout, stderr, status } = hookProcess;

    const stderrTrimmed = stderr ? stderr.trim() : '';
    const stdoutTrimmed = stdout ? stdout.trim() : '';

    if (status !== 0) {
      step.error = true;
      step.log(`Hook stderr: ${stderrTrimmed}`);
      step.setError(stdoutTrimmed);
      action.addStep(step);
      return action;
    }

    step.log('Pre-receive hook executed successfully');
    action.addStep(step);
    return action;
  } catch (error) {
    step.error = true;
    step.setError(`Hook execution error: ${error.message}`);
    action.addStep(step);
    return action;
  }
};

exec.displayName = 'executeExternalPreReceiveHook.exec';
exports.exec = exec;
