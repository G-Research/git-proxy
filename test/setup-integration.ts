import { beforeAll, afterAll, afterEach } from 'vitest';
import { MongoClient } from 'mongodb';
import { resetConnection } from '../src/db/mongo/helper';
import { invalidateCache } from '../src/config';

const TEST_DB_NAME = 'git-proxy-test';
const COLLECTIONS = ['repos', 'users', 'pushes', 'user_session'];

let client: MongoClient | null = null;
let mongoAvailable = false;

beforeAll(async () => {
  const connectionString =
    process.env.GIT_PROXY_MONGO_CONNECTION_STRING || 'mongodb://localhost:27017/git-proxy-test';

  // Try to connect to MongoDB - if unavailable, MongoDB-specific tests will be skipped
  try {
    client = new MongoClient(connectionString, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    await client.connect();
    mongoAvailable = true;
    console.log('MongoDB connection established for integration tests');
  } catch (error) {
    console.warn('MongoDB not available - MongoDB integration tests will be skipped');
    console.warn('Connection string:', connectionString);
    // Don't throw - allow non-MongoDB integration tests to run
  }
});

afterEach(async () => {
  // Clean up test data after each test (only if MongoDB is available)
  if (client && mongoAvailable) {
    const db = client.db(TEST_DB_NAME);
    for (const collection of COLLECTIONS) {
      try {
        await db.collection(collection).deleteMany({});
      } catch {
        // Collection might not exist yet, ignore
      }
    }
  }

  // Reset the helper's cached connection so each test starts fresh
  try {
    await resetConnection();
  } catch {
    // Ignore if connection wasn't established
  }
  invalidateCache();
});

afterAll(async () => {
  // Clean up and close connections
  try {
    await resetConnection();
  } catch {
    // Ignore if connection wasn't established
  }

  if (client && mongoAvailable) {
    // Drop test database
    try {
      await client.db(TEST_DB_NAME).dropDatabase();
    } catch {
      // Ignore if database doesn't exist
    }
    await client.close();
    client = null;
  }

  console.log('MongoDB integration test cleanup complete');
});

// Export for tests that need to check MongoDB availability
export { mongoAvailable };
