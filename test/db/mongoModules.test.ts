import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';

const mockHelper = vi.hoisted(() => ({
  connect: vi.fn(),
  findDocuments: vi.fn(),
  findOneDocument: vi.fn(),
}));

vi.mock('../../src/db/mongo/helper', () => ({
  connect: mockHelper.connect,
  findDocuments: mockHelper.findDocuments,
  findOneDocument: mockHelper.findOneDocument,
}));

import { Action } from '../../src/proxy/actions';
import * as pushes from '../../src/db/mongo/pushes';
import * as repo from '../../src/db/mongo/repo';
import * as users from '../../src/db/mongo/users';

describe('mongo module functions', () => {
  const collection = {
    find: vi.fn(),
    findOne: vi.fn(),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
    deleteMany: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHelper.connect.mockResolvedValue(collection);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pushes', () => {
    it('getPushes uses default query and projection', async () => {
      mockHelper.findDocuments.mockResolvedValue([{ id: '1' }]);

      const result = await pushes.getPushes();

      expect(result).toEqual([{ id: '1' }]);
      expect(mockHelper.findDocuments).toHaveBeenCalledWith(
        'pushes',
        {
          error: false,
          blocked: true,
          allowPush: false,
          authorised: false,
          type: 'push',
        },
        expect.objectContaining({
          projection: expect.objectContaining({
            id: 1,
            allowPush: 1,
            authorised: 1,
            blocked: 1,
            blockedMessage: 1,
          }),
        }),
      );
    });

    it('getPush returns null when not found', async () => {
      mockHelper.findOneDocument.mockResolvedValue(null);
      const result = await pushes.getPush('missing');
      expect(result).toBeNull();
    });

    it('getPush returns Action when found', async () => {
      mockHelper.findOneDocument.mockResolvedValue({ id: '123' });
      const result = await pushes.getPush('123');
      expect(result?.id).toBe('123');
      expect(Object.getPrototypeOf(result)).toBe(Action.prototype);
    });

    it('writeAudit throws for invalid id', async () => {
      await expect(pushes.writeAudit({ id: 123 } as any)).rejects.toThrow('Invalid id');
    });

    it('writeAudit upserts action and strips _id', async () => {
      const action = { id: 'abc', _id: 'ignored', repo: 'r1' } as any;

      await pushes.writeAudit(action);

      expect(collection.updateOne).toHaveBeenCalledWith(
        { id: 'abc' },
        { $set: { id: 'abc', repo: 'r1' } },
        { upsert: true },
      );
    });

    it('authorise updates flags and writes audit', async () => {
      mockHelper.findOneDocument.mockResolvedValue({
        id: 'p1',
        authorised: false,
        canceled: true,
        rejected: true,
      });

      const result = await pushes.authorise('p1', { note: 'ok' });

      expect(result).toEqual({ message: 'authorised p1' });
      expect(collection.updateOne).toHaveBeenCalledWith(
        { id: 'p1' },
        {
          $set: expect.objectContaining({
            authorised: true,
            canceled: false,
            rejected: false,
            attestation: { note: 'ok' },
          }),
        },
        { upsert: true },
      );
    });

    it('reject updates flags and writes audit', async () => {
      mockHelper.findOneDocument.mockResolvedValue({
        id: 'p2',
        authorised: true,
        canceled: true,
        rejected: false,
      });

      const result = await pushes.reject('p2', { reason: 'no' });

      expect(result).toEqual({ message: 'reject p2' });
      expect(collection.updateOne).toHaveBeenCalledWith(
        { id: 'p2' },
        {
          $set: expect.objectContaining({
            authorised: false,
            canceled: false,
            rejected: true,
            attestation: { reason: 'no' },
          }),
        },
        { upsert: true },
      );
    });

    it('cancel updates flags and writes audit', async () => {
      mockHelper.findOneDocument.mockResolvedValue({
        id: 'p3',
        authorised: true,
        canceled: false,
        rejected: true,
      });

      const result = await pushes.cancel('p3');

      expect(result).toEqual({ message: 'canceled p3' });
      expect(collection.updateOne).toHaveBeenCalledWith(
        { id: 'p3' },
        {
          $set: expect.objectContaining({
            authorised: false,
            canceled: true,
            rejected: false,
          }),
        },
        { upsert: true },
      );
    });

    it('deletePush removes action by id', async () => {
      await pushes.deletePush('p4');
      expect(collection.deleteOne).toHaveBeenCalledWith({ id: 'p4' });
    });
  });

  describe('repo', () => {
    it('getRepos maps docs to Repo instances', async () => {
      const toArray = vi.fn().mockResolvedValue([{ name: 'one' }]);
      collection.find.mockReturnValue({ toArray });

      const result = await repo.getRepos();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('one');
    });

    it('getRepo lowercases name in query', async () => {
      collection.findOne.mockResolvedValue({ name: 'demo' });

      const result = await repo.getRepo('DeMo');

      expect(collection.findOne).toHaveBeenCalledWith({ name: { $eq: 'demo' } });
      expect(result?.name).toBe('demo');
    });

    it('getRepoByUrl queries by url', async () => {
      collection.findOne.mockResolvedValue({ url: 'https://example.com' });

      const result = await repo.getRepoByUrl('https://example.com');

      expect(collection.findOne).toHaveBeenCalledWith({ url: { $eq: 'https://example.com' } });
      expect(result?.url).toBe('https://example.com');
    });

    it('getRepoById uses ObjectId', async () => {
      const oid = new ObjectId();
      collection.findOne.mockResolvedValue({ _id: oid, name: 'demo' });

      const result = await repo.getRepoById(oid.toString());

      expect(collection.findOne).toHaveBeenCalledWith({ _id: new ObjectId(oid.toString()) });
      expect(result?.name).toBe('demo');
    });

    it('createRepo assigns inserted id', async () => {
      const oid = new ObjectId();
      collection.insertOne.mockResolvedValue({ insertedId: oid });
      const record = { name: 'demo', users: { canPush: [], canAuthorise: [] } } as any;

      const result = await repo.createRepo(record);

      expect(result._id).toBe(oid.toString());
      expect(collection.insertOne).toHaveBeenCalled();
    });

    it('addUserCanPush lowercases user', async () => {
      const oid = new ObjectId();
      await repo.addUserCanPush(oid.toString(), 'UserA');
      expect(collection.updateOne).toHaveBeenCalledWith(
        { _id: new ObjectId(oid.toString()) },
        { $push: { 'users.canPush': 'usera' } },
      );
    });

    it('addUserCanAuthorise lowercases user', async () => {
      const oid = new ObjectId();
      await repo.addUserCanAuthorise(oid.toString(), 'UserB');
      expect(collection.updateOne).toHaveBeenCalledWith(
        { _id: new ObjectId(oid.toString()) },
        { $push: { 'users.canAuthorise': 'userb' } },
      );
    });

    it('removeUserCanPush lowercases user', async () => {
      const oid = new ObjectId();
      await repo.removeUserCanPush(oid.toString(), 'UserC');
      expect(collection.updateOne).toHaveBeenCalledWith(
        { _id: new ObjectId(oid.toString()) },
        { $pull: { 'users.canPush': 'userc' } },
      );
    });

    it('removeUserCanAuthorise lowercases user', async () => {
      const oid = new ObjectId();
      await repo.removeUserCanAuthorise(oid.toString(), 'UserD');
      expect(collection.updateOne).toHaveBeenCalledWith(
        { _id: new ObjectId(oid.toString()) },
        { $pull: { 'users.canAuthorise': 'userd' } },
      );
    });

    it('deleteRepo deletes by id', async () => {
      const oid = new ObjectId();
      await repo.deleteRepo(oid.toString());
      expect(collection.deleteMany).toHaveBeenCalledWith({ _id: new ObjectId(oid.toString()) });
    });
  });

  describe('users', () => {
    it('findUser lowercases username', async () => {
      collection.findOne.mockResolvedValue({ username: 'user' });
      const result = await users.findUser('User');
      expect(collection.findOne).toHaveBeenCalledWith({ username: { $eq: 'user' } });
      expect(result?.username).toBe('user');
    });

    it('findUserByEmail lowercases email', async () => {
      collection.findOne.mockResolvedValue({ email: 'user@example.com' });
      const result = await users.findUserByEmail('User@Example.com');
      expect(collection.findOne).toHaveBeenCalledWith({ email: { $eq: 'user@example.com' } });
      expect(result?.email).toBe('user@example.com');
    });

    it('findUserByOIDC uses oidcId', async () => {
      collection.findOne.mockResolvedValue({ oidcId: 'oidc-1' });
      const result = await users.findUserByOIDC('oidc-1');
      expect(collection.findOne).toHaveBeenCalledWith({ oidcId: { $eq: 'oidc-1' } });
      expect(result?.oidcId).toBe('oidc-1');
    });

    it('getUsers lowercases query and excludes passwords', async () => {
      const toArray = vi.fn().mockResolvedValue([{ username: 'u1' }]);
      const project = vi.fn().mockReturnValue({ toArray });
      collection.find.mockReturnValue({ project });

      const result = await users.getUsers({ username: 'U1', email: 'A@B.com' });

      expect(collection.find).toHaveBeenCalledWith({ username: 'u1', email: 'a@b.com' });
      expect(project).toHaveBeenCalledWith({ password: 0 });
      expect(result).toHaveLength(1);
    });

    it('deleteUser lowercases username', async () => {
      await users.deleteUser('UserX');
      expect(collection.deleteOne).toHaveBeenCalledWith({ username: 'userx' });
    });

    it('createUser lowercases username and email', async () => {
      const user = { username: 'UserY', email: 'A@B.com' } as any;
      await users.createUser(user);
      expect(collection.insertOne).toHaveBeenCalledWith({ username: 'usery', email: 'a@b.com' });
    });

    it('updateUser uses _id when provided', async () => {
      const oid = new ObjectId();
      await users.updateUser({ _id: oid.toString(), username: 'UserZ' });
      expect(collection.updateOne).toHaveBeenCalledWith(
        { _id: new ObjectId(oid.toString()) },
        { $set: { username: 'userz' } },
        { upsert: true },
      );
    });

    it('updateUser uses username when _id not provided', async () => {
      await users.updateUser({ username: 'UserQ', email: 'Q@E.com' });
      expect(collection.updateOne).toHaveBeenCalledWith(
        { username: 'userq' },
        { $set: { username: 'userq', email: 'q@e.com' } },
        { upsert: true },
      );
    });
  });
});
