const express = require('express');
const router = new express.Router();
const db = require('../../db');

// Get all users
router.get('/', async (req, res) => {
  const data = await db.getUsers(req.query);
  const users = JSON.parse(JSON.stringify(data));
  users.forEach((user) => delete user.password);
  res.send(users);
});

// Get specific user
router.get('/:id', async (req, res) => {
  const username = req.params.id.toLowerCase();
  console.log(`Retrieving details for user: ${username}`);
  const data = await db.findUser(username);
  const user = JSON.parse(JSON.stringify(data));
  if (user && user.password) delete user.password;
  res.send(user);
});

// Add SSH public key
router.post('/:username/ssh-keys', async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const targetUsername = req.params.username.toLowerCase();

  // Only allow users to add keys to their own account, or admins to add to any account
  if (req.user.username !== targetUsername && !req.user.admin) {
    res.status(403).json({ error: 'Not authorized to add keys for this user' });
    return;
  }

  const { publicKey } = req.body;
  if (!publicKey) {
    res.status(400).json({ error: 'Public key is required' });
    return;
  }

  // Strip the comment from the key (everything after the last space)
  const keyWithoutComment = publicKey.split(' ').slice(0, 2).join(' ');

  console.log('Adding SSH key', { targetUsername, keyWithoutComment });
  try {
    await db.addPublicKey(targetUsername, keyWithoutComment);
    res.status(201).json({ message: 'SSH key added successfully' });
  } catch (error) {
    console.error('Error adding SSH key:', error);
    res.status(500).json({ error: 'Failed to add SSH key' });
  }
});

// Remove SSH public key
router.delete('/:username/ssh-keys', async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const targetUsername = req.params.username.toLowerCase();

  // Only allow users to remove keys from their own account, or admins to remove from any account
  if (req.user.username !== targetUsername && !req.user.admin) {
    res.status(403).json({ error: 'Not authorized to remove keys for this user' });
    return;
  }

  const { publicKey } = req.body;
  if (!publicKey) {
    res.status(400).json({ error: 'Public key is required' });
    return;
  }

  try {
    await db.removePublicKey(targetUsername, publicKey);
    res.status(200).json({ message: 'SSH key removed successfully' });
  } catch (error) {
    console.error('Error removing SSH key:', error);
    res.status(500).json({ error: 'Failed to remove SSH key' });
  }
});

module.exports = router;
