import { hash, verify } from "@node-rs/argon2";

const options = {
  // @node-rs/argon2 declares Algorithm as an ambient const enum; Argon2id is 2.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(encodedHash: string, password: string): Promise<boolean>;
}

export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, options);
  }

  verify(encodedHash: string, password: string): Promise<boolean> {
    return verify(encodedHash, password);
  }
}
