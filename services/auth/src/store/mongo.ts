import mongoose, { Schema, type Connection } from 'mongoose';
import type { EventEnvelope } from '@aetheria/contracts';
import { roles } from '@aetheria/contracts';
import {
  DuplicateEmailError,
  type AuthStore,
  type NewUser,
  type RefreshTokenRecord,
  type UserRecord,
} from './types.js';

const userSchema = new Schema(
  {
    _id: { type: String },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, default: null },
    googleId: { type: String, default: null },
    role: { type: String, enum: roles, required: true },
    emailVerified: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: true }, versionKey: false },
);
userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } },
);

const refreshTokenSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { versionKey: false },
);
// MongoDB deletes expired tokens on its own.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const outboxSchema = new Schema(
  {
    _id: { type: String },
    event: { type: Schema.Types.Mixed, required: true },
    publishedAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
outboxSchema.index({ publishedAt: 1, createdAt: 1 });

type UserDoc = Omit<UserRecord, 'id'> & { _id: string };
type TokenDoc = Omit<RefreshTokenRecord, 'id'> & { _id: mongoose.Types.ObjectId };

const toUser = (d: UserDoc): UserRecord => ({
  id: d._id,
  name: d.name,
  email: d.email,
  passwordHash: d.passwordHash,
  googleId: d.googleId,
  role: d.role,
  emailVerified: d.emailVerified,
  createdAt: d.createdAt,
});
const toToken = (d: TokenDoc): RefreshTokenRecord => ({
  id: String(d._id),
  userId: d.userId,
  tokenHash: d.tokenHash,
  family: d.family,
  expiresAt: d.expiresAt,
  revokedAt: d.revokedAt,
});

export class MongoAuthStore implements AuthStore {
  private readonly User;
  private readonly RefreshToken;
  private readonly Outbox;

  constructor(private readonly conn: Connection) {
    this.User = conn.model<UserDoc>('User', userSchema, 'users');
    this.RefreshToken = conn.model<TokenDoc>('RefreshToken', refreshTokenSchema, 'refreshTokens');
    this.Outbox = conn.model('Outbox', outboxSchema, 'outbox');
  }

  static async connect(url: string): Promise<MongoAuthStore> {
    const conn = await mongoose.createConnection(url).asPromise();
    const store = new MongoAuthStore(conn);
    await Promise.all([
      store.User.syncIndexes(),
      store.RefreshToken.syncIndexes(),
      store.Outbox.syncIndexes(),
    ]);
    return store;
  }

  async createUser(user: NewUser, event: EventEnvelope): Promise<UserRecord> {
    const { id, ...rest } = user;
    try {
      let created: UserDoc | undefined;
      await this.conn.transaction(async (session) => {
        const [doc] = await this.User.create([{ _id: id, ...rest }], { session });
        await this.Outbox.create([{ _id: event.id, event }], { session });
        created = doc!.toObject() as UserDoc;
      });
      return toUser(created!);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new DuplicateEmailError();
      throw err;
    }
  }

  async findUserById(id: string) {
    const d = await this.User.findById(id).lean<UserDoc>();
    return d ? toUser(d) : null;
  }
  async findUserByEmail(email: string) {
    const d = await this.User.findOne({ email }).lean<UserDoc>();
    return d ? toUser(d) : null;
  }
  async findUserByGoogleId(googleId: string) {
    const d = await this.User.findOne({ googleId }).lean<UserDoc>();
    return d ? toUser(d) : null;
  }
  async linkGoogleId(userId: string, googleId: string) {
    await this.User.updateOne({ _id: userId }, { $set: { googleId, emailVerified: true } });
  }

  async insertRefreshToken(token: Omit<RefreshTokenRecord, 'id' | 'revokedAt'>) {
    const doc = await this.RefreshToken.create(token);
    return toToken(doc.toObject() as TokenDoc);
  }
  async findRefreshTokenByHash(tokenHash: string) {
    const d = await this.RefreshToken.findOne({ tokenHash }).lean<TokenDoc>();
    return d ? toToken(d) : null;
  }
  async revokeRefreshToken(id: string) {
    const res = await this.RefreshToken.updateOne(
      { _id: id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    return res.modifiedCount === 1;
  }
  async revokeFamily(family: string) {
    await this.RefreshToken.updateMany(
      { family, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }

  async pending(limit: number) {
    const docs = await this.Outbox.find({ publishedAt: null })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();
    return docs.map((d) => d.event as EventEnvelope);
  }
  async markPublished(eventId: string) {
    await this.Outbox.updateOne({ _id: eventId }, { $set: { publishedAt: new Date() } });
  }

  async ping() {
    await this.conn.db!.admin().ping();
    return true;
  }

  async close() {
    await this.conn.close();
  }
}
