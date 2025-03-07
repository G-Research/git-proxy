const connect = require('./helper').connect;
const usersCollection = 'users';

exports.findUser = async function (username) {
  const collection = await connect(usersCollection);
  return collection.findOne({ username: { $eq: username } });
};

exports.getUsers = async function (query) {
  console.log(`Getting users for query= ${JSON.stringify(query)}`);
  const collection = await connect(usersCollection);
  return collection.find(query, { password: 0 }).toArray();
};

exports.deleteUser = async function (username) {
  const collection = await connect(usersCollection);
  return collection.deleteOne({ username: username });
};

exports.createUser = async function (data) {
  data.username = data.username.toLowerCase();
  if (!data.publicKeys) {
    data.publicKeys = [];
  }
  const collection = await connect(usersCollection);
  return collection.insertOne(data);
};

exports.updateUser = async (user) => {
  user.username = user.username.toLowerCase();
  if (!user.publicKeys) {
    user.publicKeys = [];
  }
  const options = { upsert: true };
  const collection = await connect(usersCollection);
  await collection.updateOne({ username: user.username }, { $set: user }, options);
};

exports.addPublicKey = async (username, publicKey) => {
  const collection = await connect(usersCollection);
  return collection.updateOne(
    { username: username.toLowerCase() },
    { $addToSet: { publicKeys: publicKey } },
  );
};

exports.removePublicKey = async (username, publicKey) => {
  const collection = await connect(usersCollection);
  return collection.updateOne(
    { username: username.toLowerCase() },
    { $pull: { publicKeys: publicKey } },
  );
};

exports.findUserBySSHKey = async function (sshKey) {
  const collection = await connect(usersCollection);
  return collection.findOne({ publicKeys: { $eq: sshKey } });
};
