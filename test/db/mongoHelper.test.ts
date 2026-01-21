import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockMongo = vi.hoisted(() => ({
  connect: vi.fn(),
  db: { collection: vi.fn() },
}));

vi.mock('mongodb', async () => {
  const actual = await vi.importActual<typeof import('mongodb')>('mongodb');

  class MongoClient {
    connectionString: string;
    options: any;
    constructor(connectionString: string, options: any) {
      this.connectionString = connectionString;
      this.options = options;
    }
    async connect() {
      mockMongo.connect();
      return this;
    }
    db() {
      return mockMongo.db;
    }
  }

  return { ...actual, MongoClient };
});

const mockAws = vi.hoisted(() => ({
  fromNodeProviderChain: vi.fn(() => 'mock-credentials'),
}));
vi.mock('@aws-sdk/credential-providers', () => ({
  fromNodeProviderChain: mockAws.fromNodeProviderChain,
}));

const mockMongoStore = vi.hoisted(() => ({
  lastOpts: null as unknown,
  MockStore: vi.fn(),
}));
vi.mock('connect-mongo', () => ({
  default: class MockStore {
    opts: unknown;
    constructor(opts: unknown) {
      this.opts = opts;
      mockMongoStore.lastOpts = opts;
      mockMongoStore.MockStore(opts);
    }
  },
}));

const mockConfig = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}));
vi.mock('../../src/config', () => ({
  getDatabase: mockConfig.getDatabase,
}));

import * as helper from '../../src/db/mongo/helper';

describe('mongo helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMongo.db.collection.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connect throws when connection string is missing', async () => {
    mockConfig.getDatabase.mockReturnValue({ connectionString: '', options: {} });
    await expect(helper.connect('repos')).rejects.toThrow(
      'MongoDB connection string is not provided',
    );
  });

  it('connect uses AWS provider chain when configured', async () => {
    const options = { authMechanismProperties: { AWS_CREDENTIAL_PROVIDER: true } };
    mockConfig.getDatabase.mockReturnValue({ connectionString: 'mongodb://example', options });
    mockMongo.db.collection.mockReturnValue({ name: 'repos' });

    const collection = await helper.connect('repos');

    expect(collection).toEqual({ name: 'repos' });
    expect(mockMongo.connect).toHaveBeenCalledTimes(1);
    expect(mockAws.fromNodeProviderChain).toHaveBeenCalledTimes(1);
    expect(options.authMechanismProperties.AWS_CREDENTIAL_PROVIDER).toBe('mock-credentials');
  });

  it('findDocuments uses connect and returns results', async () => {
    const docs = [{ id: 1 }];
    const toArray = vi.fn().mockResolvedValue(docs);
    const find = vi.fn().mockReturnValue({ toArray });
    mockMongo.db.collection.mockReturnValue({ find });
    mockConfig.getDatabase.mockReturnValue({ connectionString: 'mongodb://example', options: {} });

    const result = await helper.findDocuments('repos', { id: 1 });

    expect(result).toEqual(docs);
    expect(find).toHaveBeenCalledWith({ id: 1 }, {});
  });

  it('findOneDocument uses connect and returns the record', async () => {
    const findOne = vi.fn().mockResolvedValue({ id: 2 });
    mockMongo.db.collection.mockReturnValue({ findOne });
    mockConfig.getDatabase.mockReturnValue({ connectionString: 'mongodb://example', options: {} });

    const result = await helper.findOneDocument('repos', { id: 2 });

    expect(result).toEqual({ id: 2 });
    expect(findOne).toHaveBeenCalledWith({ id: 2 }, {});
  });

  it('getSessionStore uses database config', () => {
    mockConfig.getDatabase.mockReturnValue({
      connectionString: 'mongodb://example',
      options: { tls: true },
    });

    const store = helper.getSessionStore();

    expect(store).toEqual({
      opts: {
        mongoUrl: 'mongodb://example',
        collectionName: 'user_session',
        mongoOptions: { tls: true },
      },
    });
    expect(mockMongoStore.MockStore).toHaveBeenCalledTimes(1);
  });
});
