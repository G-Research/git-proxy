const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const EventEmitter = require('events');

class ConfigLoader extends EventEmitter {
  constructor(initialConfig) {
    super();
    this.config = initialConfig;
    this.reloadTimer = null;
    this.isReloading = false;
  }

  async start() {
    const { configurationSources } = this.config;
    if (!configurationSources?.enabled) {
      return;
    }

    // Start periodic reload if interval is set
    if (configurationSources.reloadIntervalSeconds > 0) {
      this.reloadTimer = setInterval(
        () => this.reloadConfiguration(),
        configurationSources.reloadIntervalSeconds * 1000,
      );
    }

    // Do initial load
    await this.reloadConfiguration();
  }

  stop() {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  async reloadConfiguration() {
    if (this.isReloading) return;
    this.isReloading = true;

    try {
      const { configurationSources } = this.config;
      if (!configurationSources?.enabled) return;

      const configs = await Promise.all(
        configurationSources.sources
          .filter((source) => source.enabled)
          .map((source) => this.loadFromSource(source)),
      );

      // Merge configurations in order
      const newConfig = configs.reduce(
        (acc, curr) => {
          return this.deepMerge(acc, curr);
        },
        { ...this.config },
      );

      // Emit change event if config changed
      if (JSON.stringify(newConfig) !== JSON.stringify(this.config)) {
        this.config = newConfig;
        this.emit('configurationChanged', this.config);
      }
    } catch (error) {
      console.error('Error reloading configuration:', error);
      this.emit('configurationError', error);
    } finally {
      this.isReloading = false;
    }
  }

  async loadFromSource(source) {
    switch (source.type) {
      case 'file':
        return this.loadFromFile(source);
      case 'http':
        return this.loadFromHttp(source);
      case 'git':
        return this.loadFromGit(source);
      default:
        throw new Error(`Unsupported configuration source type: ${source.type}`);
    }
  }

  async loadFromFile(source) {
    const configPath = path.resolve(process.cwd(), source.path);
    const content = await fs.promises.readFile(configPath, 'utf8');
    return JSON.parse(content);
  }

  async loadFromHttp(source) {
    const headers = {
      ...source.headers,
      ...(source.auth?.type === 'bearer' ? { Authorization: `Bearer ${source.auth.token}` } : {}),
    };

    const response = await axios.get(source.url, { headers });
    return response.data;
  }

  async loadFromGit(source) {
    const tempDir = path.join(process.cwd(), '.git-config-cache');
    await fs.promises.mkdir(tempDir, { recursive: true });

    const repoDir = path.join(tempDir, Buffer.from(source.repository).toString('base64'));

    // Clone or pull repository
    if (!fs.existsSync(repoDir)) {
      const cloneCmd = `git clone ${source.repository} ${repoDir}`;
      if (source.auth?.type === 'ssh') {
        process.env.GIT_SSH_COMMAND = `ssh -i ${source.auth.privateKeyPath}`;
      }
      await execAsync(cloneCmd);
    } else {
      await execAsync('git pull', { cwd: repoDir });
    }

    // Checkout specific branch if specified
    if (source.branch) {
      await execAsync(`git checkout ${source.branch}`, { cwd: repoDir });
    }

    // Read and parse config file
    const configPath = path.join(repoDir, source.path);
    const content = await fs.promises.readFile(configPath, 'utf8');
    return JSON.parse(content);
  }

  deepMerge(target, source) {
    const output = { ...target };
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach((key) => {
        if (isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

module.exports = ConfigLoader;
