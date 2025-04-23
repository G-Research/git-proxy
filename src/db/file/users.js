const fs = require('fs');
const Datastore = require('@seald-io/nedb');

if (!fs.existsSync('./.data')) fs.mkdirSync('./.data');
if (!fs.existsSync('./.data/db')) fs.mkdirSync('./.data/db');

const db = new Datastore({ filename: './.data/db/users.db', autoload: true });

exports.findUser = function (username) {
  return new Promise((resolve, reject) => {
    db.findOne({ username: username }, (err, doc) => {
      if (err) {
        reject(err);
      } else {
        if (!doc) {
          resolve(null);
        } else {
          resolve(doc);
        }
      }
    });
  });
};

exports.findUserByOIDC = function (oidcId) {
  return new Promise((resolve, reject) => {
    db.findOne({ oidcId: oidcId }, (err, doc) => {
      if (err) {
        reject(err);
      } else {
        if (!doc) {
          resolve(null);
        } else {
          resolve(doc);
        }
      }
    });
  });
};

exports.createUser = function (data) {
  if (!data.publicKeys) {
    data.publicKeys = [];
  }
  return new Promise((resolve, reject) => {
    db.insert(data, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

exports.deleteUser = function (username) {
  return new Promise((resolve, reject) => {
    db.remove({ username: username }, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

exports.updateUser = function (user) {
  if (!user.publicKeys) {
    user.publicKeys = [];
  }
  return new Promise((resolve, reject) => {
    const options = { multi: false, upsert: false };
    db.update({ username: user.username }, user, options, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(null);
      }
    });
  });
};

exports.getUsers = function (query) {
  if (!query) query = {};
  return new Promise((resolve, reject) => {
    db.find(query, (err, docs) => {
      if (err) {
        reject(err);
      } else {
        resolve(docs);
      }
    });
  });
};

exports.addPublicKey = function (username, publicKey) {
  return new Promise((resolve, reject) => {
    exports
      .findUser(username)
      .then((user) => {
        if (!user) {
          reject(new Error('User not found'));
          return;
        }
        if (!user.publicKeys) {
          user.publicKeys = [];
        }
        if (!user.publicKeys.includes(publicKey)) {
          user.publicKeys.push(publicKey);
          exports.updateUser(user).then(resolve).catch(reject);
        } else {
          resolve();
        }
      })
      .catch(reject);
  });
};

exports.removePublicKey = function (username, publicKey) {
  return new Promise((resolve, reject) => {
    exports
      .findUser(username)
      .then((user) => {
        if (!user) {
          reject(new Error('User not found'));
          return;
        }
        if (!user.publicKeys) {
          user.publicKeys = [];
          resolve();
          return;
        }
        user.publicKeys = user.publicKeys.filter((key) => key !== publicKey);
        exports.updateUser(user).then(resolve).catch(reject);
      })
      .catch(reject);
  });
};

exports.findUserBySSHKey = function (sshKey) {
  return new Promise((resolve, reject) => {
    db.findOne({ publicKeys: sshKey }, (err, doc) => {
      if (err) {
        reject(err);
      } else {
        if (!doc) {
          resolve(null);
        } else {
          resolve(doc);
        }
      }
    });
  });
};
